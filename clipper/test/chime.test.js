import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeChime } from '../src/chime.js';

test('chime is short, stereo and not too loud', () => {
  const pcm = makeChime();
  const seconds = pcm.length / 4 / 48_000;
  assert.ok(seconds > 0.2 && seconds < 1, `chime lasts ${seconds}s`);
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  assert.ok(peak > 1000 && peak <= 6000);
});
