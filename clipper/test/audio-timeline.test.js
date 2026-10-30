import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioTimeline, toWhisperPcm } from '../src/audio-timeline.js';

const FRAME_MS = 20;
const frame = (value) => {
  const b = Buffer.alloc(960 * 2 * 2);
  for (let i = 0; i < b.length; i += 2) b.writeInt16LE(value, i);
  return b;
};
const sampleAt = (pcm, ms) => pcm.readInt16LE(Math.round(ms * 48) * 4);

test('renders a clip with the right length', () => {
  const tl = new AudioTimeline();
  const pcm = tl.render(0, 20_000);
  assert.equal(pcm.length, 20 * 48_000 * 4);
});

test('places audio at its wall-clock position and keeps silence silent', () => {
  const tl = new AudioTimeline();
  for (let t = 1000 + FRAME_MS; t <= 2000; t += FRAME_MS) tl.push('a', frame(1000), t);
  for (let t = 5000 + FRAME_MS; t <= 6000; t += FRAME_MS) tl.push('a', frame(2000), t);
  const pcm = tl.render(0, 10_000);
  assert.equal(sampleAt(pcm, 500), 0);
  assert.equal(sampleAt(pcm, 1500), 1000);
  assert.equal(sampleAt(pcm, 3000), 0);
  assert.equal(sampleAt(pcm, 5500), 2000);
  assert.equal(sampleAt(pcm, 8000), 0);
});

test('mixes overlapping speakers instead of putting them back to back', () => {
  const tl = new AudioTimeline();
  for (let t = FRAME_MS; t <= 1000; t += FRAME_MS) {
    tl.push('a', frame(1000), t);
    tl.push('b', frame(500), t);
  }
  const pcm = tl.render(0, 1000);
  assert.equal(sampleAt(pcm, 500), 1500);
  assert.equal(tl.render(0, 1000, { userIds: ['b'] }).readInt16LE(500 * 48 * 4), 500);
});

test('clamps loud mixes instead of wrapping around', () => {
  const tl = new AudioTimeline();
  tl.push('a', frame(30_000), 20);
  tl.push('b', frame(30_000), 20);
  assert.equal(sampleAt(tl.render(0, 20), 10), 32767);
});

test('lays jittery packets end to end', () => {
  const tl = new AudioTimeline();
  // Two packets arriving at the same moment after a network hiccup.
  const s1 = tl.push('a', frame(1), 100);
  const s2 = tl.push('a', frame(1), 100);
  assert.equal(s1, 80);
  assert.equal(s2, 100);
});

test('drops audio older than the retention window', () => {
  const tl = new AudioTimeline({ retentionMs: 1000 });
  tl.push('a', frame(1000), 20);
  tl.push('b', frame(1000), 5000);
  assert.equal(sampleAt(tl.render(0, 100), 10), 0);
  assert.equal(tl.speakers.has('a'), false);
});

test('downmixes 48 kHz stereo to 16 kHz mono', () => {
  const out = toWhisperPcm(frame(1200));
  assert.equal(out.length, 320 * 2);
  assert.equal(out.readInt16LE(0), 1200);
});
