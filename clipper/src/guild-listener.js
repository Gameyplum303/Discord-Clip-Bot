import { Readable } from 'node:stream';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  joinVoiceChannel,
  entersState,
  EndBehaviorType,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import prism from 'prism-media';
import { AudioTimeline, toWhisperPcm } from './audio-timeline.js';
import { findTrigger } from './triggers.js';
import { makeChime } from './chime.js';

// Each speaker's audio is sent to speech recognition in windows of this size,
// or sooner when they stop talking.
const STT_WINDOW_MS = 5000;
// Re-send the tail of the previous window so a word cut in half is still heard.
const STT_OVERLAP_MS = 1000;
// Extra wait after the "after" period so late packets make it into the clip.
const CLIP_SETTLE_MS = 500;
// The same spoken word can show up in two overlapping windows.
const DUPLICATE_HIT_MS = 1500;
// Minimum gap between one person's /clip now requests.
const MANUAL_CLIP_COOLDOWN_MS = 10_000;
// After a /clip test ends, wait this long for the last speech recognition results.
const TEST_SETTLE_MS = 3000;

const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Owns the voice connection for one server: receives audio, keeps the rolling
// timeline, runs trigger detection and posts clips.
export class GuildListener {
  constructor({ guild, voiceChannel, fallbackTextChannel, config, stt, saveClip, log = console }) {
    this.guild = guild;
    this.voiceChannel = voiceChannel;
    this.fallbackTextChannel = fallbackTextChannel;
    this.config = config; // () => current guild config
    this.stt = stt;
    this.saveClip = saveClip; // async ({ pcm, hit, userId, channel }) => void
    this.log = log;

    this.timeline = new AudioTimeline({ retentionMs: 60_000 });
    this.subscriptions = new Map(); // userId -> { stream, windowStartMs, carry }
    this.cooldownUntil = 0;
    this.lastHitMs = -Infinity;
    this.pendingClips = new Set();
    this.manualClipAt = new Map(); // userId -> last /clip now time
    this.testers = new Map(); // userId -> { heard: [] } while /clip test runs
    this.destroyed = false;
  }

  async connect() {
    const connection = joinVoiceChannel({
      channelId: this.voiceChannel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: false,
      // Stay muted unless the "clipped" sound is turned on.
      selfMute: !this.config().sound,
    });
    this.connection = connection;

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Moved to another channel or a brief network blip: wait for it to recover.
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        this.destroy();
      }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy());

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    connection.receiver.speaking.on('start', (userId) => this.subscribe(userId));
  }

  subscribe(userId) {
    if (this.destroyed || this.subscriptions.has(userId)) return;
    const member = this.guild.members.cache.get(userId);
    if (member?.user.bot) return;
    // People who opted out are never recorded or transcribed.
    if (this.config().optedOut.includes(userId)) return;

    const stream = this.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
    });
    const decoder = new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
    const sub = { stream, windowStartMs: null, carry: false };
    this.subscriptions.set(userId, sub);

    decoder.on('data', (pcm) => this.onPcm(userId, sub, pcm));
    decoder.on('error', (err) => this.log.warn?.(`Opus decode error for ${userId}: ${err.message}`));
    const finish = () => {
      if (this.subscriptions.get(userId) !== sub) return;
      this.subscriptions.delete(userId);
      this.flush(userId, sub, now(), false);
    };
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);
    stream.pipe(decoder);
  }

  onPcm(userId, sub, pcm) {
    const t = now();
    const startMs = this.timeline.push(userId, pcm, t);
    if (sub.windowStartMs === null) sub.windowStartMs = startMs;
    if (t - sub.windowStartMs >= STT_WINDOW_MS) this.flush(userId, sub, t, true);
  }

  // Send this speaker's audio since the last window to speech recognition.
  flush(userId, sub, endMs, continuing) {
    if (sub.windowStartMs === null) return;
    const startMs = sub.windowStartMs - (sub.carry ? STT_OVERLAP_MS : 0);
    sub.windowStartMs = continuing ? endMs : null;
    sub.carry = continuing;

    const { triggers } = this.config();
    const testing = this.testers.has(userId);
    if (this.destroyed) return;
    if (!testing && (!triggers.length || now() < this.cooldownUntil)) return;

    const pcm = toWhisperPcm(this.timeline.render(startMs, endMs, { userIds: [userId] }));
    this.stt
      .transcribe(pcm, { hotwords: triggers.join(', ') })
      .then((words) => this.onWords(userId, startMs, words))
      .catch((err) => this.log.warn?.(`Speech recognition failed: ${err.message}`));
  }

  onWords(userId, windowStartMs, words) {
    if (this.destroyed) return;
    const cfg = this.config();
    const hit = findTrigger(words, cfg.triggers, { fuzzy: cfg.fuzzy });
    this.testers.get(userId)?.heard.push({ text: words.map((w) => w.word).join('').trim(), trigger: hit?.trigger ?? null });
    if (!hit || !cfg.triggers.length) return;
    hit.transcript = words.map((w) => w.word).join('').trim();

    const hitMs = windowStartMs + hit.start * 1000;
    const t = now();
    if (t < this.cooldownUntil || Math.abs(hitMs - this.lastHitMs) < DUPLICATE_HIT_MS) return;
    this.cooldownUntil = t + cfg.cooldownSec * 1000;
    this.lastHitMs = hitMs;

    this.log.info?.(`[${this.guild.name}] heard "${hit.trigger}" from ${userId}`);
    const clipStart = hitMs - cfg.beforeSec * 1000;
    const clipEnd = hitMs + cfg.afterSec * 1000;
    const timer = setTimeout(() => {
      this.pendingClips.delete(timer);
      this.postClip({ clipStart, clipEnd, hit, userId, cfg });
    }, Math.max(0, clipEnd + CLIP_SETTLE_MS - t));
    this.pendingClips.add(timer);
  }

  async postClip({ clipStart, clipEnd, hit, userId, cfg }) {
    try {
      const pcm = this.timeline.render(clipStart, clipEnd);
      // A per-trigger channel wins, then the server's clips channel, then where /clip join was used.
      const channelId = (hit && cfg.triggerChannels[hit.trigger]) || cfg.channelId;
      const channel =
        (channelId && (await this.guild.channels.fetch(channelId).catch(() => null))) ||
        this.fallbackTextChannel;
      if (!channel) {
        this.log.warn?.(`[${this.guild.name}] no output channel set, dropping clip`);
        return;
      }
      await this.saveClip({ pcm, hit, userId, channel, cfg, voiceChannel: this.voiceChannel });
      if (cfg.sound) this.playChime();
    } catch (err) {
      this.log.error?.(`[${this.guild.name}] failed to post clip:`, err);
    }
  }

  // /clip now: post the last (before + after) seconds straight away.
  // Returns false if this person asked too recently.
  clipNow(userId) {
    const t = now();
    if (t - (this.manualClipAt.get(userId) ?? -Infinity) < MANUAL_CLIP_COOLDOWN_MS) return false;
    this.manualClipAt.set(userId, t);
    const cfg = this.config();
    this.postClip({ clipStart: t - (cfg.beforeSec + cfg.afterSec) * 1000, clipEnd: t, hit: null, userId, cfg });
    return true;
  }

  // /clip test: transcribe everything this person says for durationMs, even
  // with no triggers set or during the cooldown, and return what was heard.
  async runTest(userId, durationMs) {
    const tester = { heard: [] };
    this.testers.set(userId, tester);
    try {
      await sleep(durationMs);
      const sub = this.subscriptions.get(userId);
      if (sub) this.flush(userId, sub, now(), true);
      await sleep(TEST_SETTLE_MS);
      return tester.heard.filter((h) => h.text);
    } finally {
      if (this.testers.get(userId) === tester) this.testers.delete(userId);
    }
  }

  // Stop recording someone and drop the audio already buffered for them.
  forgetUser(userId) {
    const sub = this.subscriptions.get(userId);
    this.subscriptions.delete(userId);
    sub?.stream.destroy();
    this.timeline.speakers.delete(userId);
    this.testers.delete(userId);
  }

  // Mute or unmute the bot in the call when the "clipped" sound is switched on or off.
  setSound(on) {
    if (this.destroyed || !this.connection) return;
    this.connection.rejoin({ channelId: this.voiceChannel.id, selfDeaf: false, selfMute: !on });
  }

  playChime() {
    if (this.destroyed || !this.connection) return;
    if (!this.player) {
      this.player = createAudioPlayer();
      this.player.on('error', (err) => this.log.warn?.(`Chime playback failed: ${err.message}`));
      this.connection.subscribe(this.player);
    }
    if (this.player.state.status !== AudioPlayerStatus.Idle) return;
    this.player.play(createAudioResource(Readable.from([makeChime()]), { inputType: StreamType.Raw }));
  }

  status() {
    return {
      channel: this.voiceChannel,
      speakers: this.subscriptions.size,
      onCooldown: now() < this.cooldownUntil,
    };
  }

  // Leave the voice channel. Clips already triggered are still posted.
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const sub of this.subscriptions.values()) sub.stream.destroy();
    this.subscriptions.clear();
    this.player?.stop(true);
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.onDestroy?.();
  }
}
