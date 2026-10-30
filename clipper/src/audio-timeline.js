// Rolling, wall-clock-aligned store of decoded voice audio for one guild.
//
// Discord only sends packets while someone is talking, and each speaker has
// their own stream. Each 20 ms PCM frame is stored with the time it belongs
// at, so a clip can be rendered as a real stretch of time: speakers are mixed
// on top of each other and silence between packets stays silent.

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
const BYTES_PER_SAMPLE_FRAME = CHANNELS * 2; // stereo, 16-bit
const SAMPLES_PER_MS = SAMPLE_RATE / 1000;

// Frames that arrive within this gap of the previous one are treated as
// continuous speech and laid end to end, which absorbs network jitter.
const CONTIGUOUS_GAP_MS = 100;
// If a speaker's laid-out audio drifts this far ahead of real time, re-anchor.
const MAX_DRIFT_MS = 200;

export class AudioTimeline {
  constructor({ retentionMs = 60_000 } = {}) {
    this.retentionMs = retentionMs;
    this.speakers = new Map(); // userId -> { frames: [{ startMs, pcm }], lastEndMs }
  }

  push(userId, pcm, arrivalMs) {
    const durationMs = pcm.length / BYTES_PER_SAMPLE_FRAME / SAMPLES_PER_MS;
    let speaker = this.speakers.get(userId);
    if (!speaker) {
      speaker = { frames: [], lastEndMs: null };
      this.speakers.set(userId, speaker);
    }

    let startMs = arrivalMs - durationMs;
    const last = speaker.lastEndMs;
    if (last !== null && startMs - last < CONTIGUOUS_GAP_MS && last - arrivalMs < MAX_DRIFT_MS) {
      startMs = last;
    }
    speaker.frames.push({ startMs, pcm });
    speaker.lastEndMs = startMs + durationMs;

    this.prune(arrivalMs);
    return startMs;
  }

  prune(nowMs) {
    const cutoff = nowMs - this.retentionMs;
    for (const [userId, speaker] of this.speakers) {
      const frames = speaker.frames;
      let drop = 0;
      while (drop < frames.length && frameEnd(frames[drop]) < cutoff) drop++;
      if (drop) frames.splice(0, drop);
      if (!frames.length && (speaker.lastEndMs ?? 0) < cutoff) this.speakers.delete(userId);
    }
  }

  // Mix [startMs, endMs) into one 48 kHz stereo s16le buffer. Pass userIds to
  // render only some speakers.
  render(startMs, endMs, { userIds = null } = {}) {
    const totalSamples = Math.max(0, Math.round((endMs - startMs) * SAMPLES_PER_MS));
    const mix = new Int32Array(totalSamples * CHANNELS);

    for (const [userId, speaker] of this.speakers) {
      if (userIds && !userIds.includes(userId)) continue;
      for (const frame of speaker.frames) {
        if (frameEnd(frame) <= startMs || frame.startMs >= endMs) continue;
        const src = new Int16Array(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.length >> 1);
        const offset = Math.round((frame.startMs - startMs) * SAMPLES_PER_MS) * CHANNELS;
        const from = Math.max(0, -offset);
        const to = Math.min(src.length, mix.length - offset);
        for (let i = from; i < to; i++) mix[offset + i] += src[i];
      }
    }

    const out = Buffer.alloc(mix.length * 2);
    for (let i = 0; i < mix.length; i++) {
      out.writeInt16LE(Math.max(-32768, Math.min(32767, mix[i])), i * 2);
    }
    return out;
  }

  clear() {
    this.speakers.clear();
  }
}

function frameEnd(frame) {
  return frame.startMs + frame.pcm.length / BYTES_PER_SAMPLE_FRAME / SAMPLES_PER_MS;
}

// 48 kHz stereo s16le -> 16 kHz mono s16le, the format Whisper expects.
// Averages each group of 3 stereo samples, which doubles as a crude low-pass.
export function toWhisperPcm(pcm48kStereo) {
  const src = new Int16Array(pcm48kStereo.buffer, pcm48kStereo.byteOffset, pcm48kStereo.length >> 1);
  const outSamples = Math.floor(src.length / CHANNELS / 3);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const k = (i * 3 + j) * CHANNELS;
      sum += src[k] + src[k + 1];
    }
    out.writeInt16LE(Math.round(sum / 6), i * 2);
  }
  return out;
}
