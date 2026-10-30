import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { encodeMp3 } from '../src/mp3.js';

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

test('encodes 20 seconds of PCM to a small MP3', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const pcm = Buffer.alloc(20 * 48_000 * 4);
  const mp3 = await encodeMp3(pcm);
  assert.ok(mp3.length > 10_000 && mp3.length < 1_000_000, `unexpected size ${mp3.length}`);
  // ID3 tag or MPEG frame sync
  assert.ok(mp3.subarray(0, 3).toString() === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0));
});

test('trims an MP3 to the requested range', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { trimMp3 } = await import('../src/mp3.js');
  const full = await encodeMp3(Buffer.alloc(20 * 48_000 * 4));
  const short = await trimMp3(full, 5, 10);
  // 5 s at 128 kbps is about 80 KB; the full clip is about 320 KB.
  assert.ok(short.length > 60_000 && short.length < 120_000, `unexpected size ${short.length}`);
});
