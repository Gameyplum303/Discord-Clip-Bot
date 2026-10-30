import { SAMPLE_RATE, CHANNELS } from './audio-timeline.js';

// A short, quiet two-note chime as 48 kHz stereo s16le, generated in code so
// nothing has to be downloaded or bundled.
export function makeChime() {
  const notes = [
    { freq: 880, ms: 120 },
    { freq: 1320, ms: 220 },
  ];
  const total = notes.reduce((n, x) => n + Math.round((x.ms / 1000) * SAMPLE_RATE), 0);
  const out = Buffer.alloc(total * CHANNELS * 2);
  let i = 0;
  for (const { freq, ms } of notes) {
    const n = Math.round((ms / 1000) * SAMPLE_RATE);
    for (let k = 0; k < n; k++, i++) {
      const fade = Math.min(1, k / 480, (n - k) / 2400); // soft attack and release
      const v = Math.round(Math.sin((2 * Math.PI * freq * k) / SAMPLE_RATE) * 6000 * fade);
      for (let c = 0; c < CHANNELS; c++) out.writeInt16LE(v, (i * CHANNELS + c) * 2);
    }
  }
  return out;
}
