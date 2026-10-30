import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { GuildListener } from '../src/guild-listener.js';
import { DEFAULTS } from '../src/config-store.js';

const frame = (value) => {
  const b = Buffer.alloc(960 * 2 * 2);
  for (let i = 0; i < b.length; i += 2) b.writeInt16LE(value, i);
  return b;
};

// Pretends to be Whisper: reports a "clip" word wherever the audio gets loud,
// so the test checks that word timestamps map back to the right moment.
const fakeStt = {
  calls: 0,
  async transcribe(pcm) {
    this.calls++;
    for (let i = 0; i < pcm.length; i += 2) {
      if (Math.abs(pcm.readInt16LE(i)) > 1000) return [{ word: ' Clip!', start: i / 2 / 16_000, end: i / 2 / 16_000 + 0.1 }];
    }
    return [];
  },
};

function makeListener(cfg, clips) {
  const channel = { id: 'text' };
  return new GuildListener({
    guild: { id: 'g', name: 'test', members: { cache: new Map() }, channels: { fetch: async () => null } },
    voiceChannel: { id: 'voice' },
    fallbackTextChannel: channel,
    config: () => ({ ...DEFAULTS, ...cfg }),
    stt: fakeStt,
    saveClip: async (clip) => clips.push(clip),
    log: {},
  });
}

test('clips audio centred on the trigger word, before and after', async () => {
  const clips = [];
  const listener = makeListener({ triggers: ['clip'], beforeSec: 1, afterSec: 1 }, clips);
  const sub = { windowStartMs: null, carry: false };

  // 1.5 s of speech where 200 ms in the middle is the "trigger word".
  for (let i = 0; i < 75; i++) {
    listener.onPcm('u1', sub, frame(i >= 30 && i < 40 ? 8000 : 200));
    await sleep(20);
  }
  listener.flush('u1', sub, performance.now(), false);
  await sleep(2000);

  assert.equal(clips.length, 1);
  const { pcm, hit, userId, channel } = clips[0];
  assert.equal(hit.trigger, 'clip');
  assert.equal(userId, 'u1');
  assert.equal(channel.id, 'text');
  assert.equal(pcm.length, 2 * 48_000 * 4);

  // The loud part should start right at the 1 s mark of the 2 s clip.
  let firstLoud = -1;
  for (let i = 0; i < pcm.length; i += 4) {
    if (pcm.readInt16LE(i) > 1000) { firstLoud = i / 4 / 48; break; }
  }
  assert.ok(Math.abs(firstLoud - 1000) < 30, `trigger landed at ${firstLoud} ms`);
  listener.destroy();
});

test('respects the cooldown and skips work with no triggers', async () => {
  const clips = [];
  const listener = makeListener({ triggers: [], beforeSec: 1, afterSec: 0 }, clips);
  const sub = { windowStartMs: null, carry: false };
  const before = fakeStt.calls;
  listener.onPcm('u1', sub, frame(8000));
  listener.flush('u1', sub, performance.now(), false);
  assert.equal(fakeStt.calls, before, 'no STT call without triggers');

  const listener2 = makeListener({ triggers: ['clip'], beforeSec: 1, afterSec: 0, cooldownSec: 60 }, clips);
  listener2.onWords('u1', performance.now() - 5000, [{ word: 'clip', start: 0, end: 0.2 }]);
  listener2.onWords('u1', performance.now(), [{ word: 'clip', start: 0, end: 0.2 }]);
  await sleep(700);
  assert.equal(clips.length, 1);
  listener.destroy();
  listener2.destroy();
});

test('/clip now posts the last before+after seconds, rate-limited per person', async () => {
  const clips = [];
  const listener = makeListener({ beforeSec: 1, afterSec: 1 }, clips);
  assert.equal(listener.clipNow('u1'), true);
  assert.equal(listener.clipNow('u1'), false);
  assert.equal(listener.clipNow('u2'), true);
  await sleep(50);
  assert.equal(clips.length, 2);
  assert.equal(clips[0].hit, null);
  assert.equal(clips[0].pcm.length, 2 * 48_000 * 4);
  listener.destroy();
});

test('/clip test reports what was heard even with no triggers set', async () => {
  const listener = makeListener({ triggers: [] }, []);
  const sub = { windowStartMs: null, carry: false };
  const result = listener.runTest('u1', 300);
  for (let i = 0; i < 10; i++) {
    listener.onPcm('u1', sub, frame(8000));
    await sleep(20);
  }
  listener.flush('u1', sub, performance.now(), false);
  const heard = await result;
  assert.deepEqual(heard, [{ text: 'Clip!', trigger: null }]);
  listener.destroy();
});

test('opted-out people are not recorded and their audio is dropped', () => {
  const listener = makeListener({ optedOut: ['u1'] }, []);
  listener.connection = { receiver: { subscribe: () => assert.fail('should not subscribe') }, state: { status: 'destroyed' } };
  listener.subscribe('u1');
  assert.equal(listener.subscriptions.size, 0);

  listener.timeline.push('u2', frame(100), performance.now());
  listener.forgetUser('u2');
  assert.equal(listener.timeline.speakers.has('u2'), false);
  listener.destroy();
});

test('per-trigger channels win over the normal clips channel', async () => {
  const clips = [];
  const listener = makeListener({ triggers: ['clip', 'wow'], beforeSec: 1, afterSec: 0, cooldownSec: 0, channelId: 'main', triggerChannels: { wow: 'wowchan' } }, clips);
  listener.guild.channels.fetch = async (id) => ({ id });
  listener.onWords('u1', performance.now() - 2000, [{ word: 'wow', start: 0, end: 0.2 }]);
  listener.onWords('u1', performance.now(), [{ word: 'clip', start: 0, end: 0.2 }]);
  await sleep(1000);
  assert.deepEqual(clips.map((c) => c.channel.id).sort(), ['main', 'wowchan']);
  assert.equal(clips.find((c) => c.channel.id === 'wowchan').hit.transcript, 'wow');
  listener.destroy();
});

test('fuzzy matching only applies when turned on', async () => {
  const clips = [];
  const strict = makeListener({ triggers: ['bookmark'], beforeSec: 1, afterSec: 0 }, clips);
  strict.onWords('u1', performance.now(), [{ word: 'bookmarc', start: 0, end: 0.2 }]);
  const fuzzy = makeListener({ triggers: ['bookmark'], beforeSec: 1, afterSec: 0, fuzzy: true }, clips);
  fuzzy.onWords('u1', performance.now(), [{ word: 'bookmarc', start: 0, end: 0.2 }]);
  await sleep(700);
  assert.equal(clips.length, 1);
  strict.destroy();
  fuzzy.destroy();
});
