import { spawn } from 'node:child_process';
import { SAMPLE_RATE, CHANNELS } from './audio-timeline.js';

// Encode raw 48 kHz stereo s16le PCM to MP3 with ffmpeg.
export function encodeMp3(pcm, { bitrate = '128k', ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0',
      '-codec:a', 'libmp3lame', '-b:a', bitrate,
      '-f', 'mp3', 'pipe:1',
    ]);
    const chunks = [];
    let stderr = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => { stderr += c; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`));
    });
    ff.stdin.on('error', () => {}); // surfaced via 'close'
    ff.stdin.end(pcm);
  });
}

// Cut an MP3 down to [startSec, endSec) and re-encode it.
export function trimMp3(mp3, startSec, endSec, { bitrate = '128k', ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'mp3', '-i', 'pipe:0',
      '-ss', startSec.toFixed(2), '-to', endSec.toFixed(2),
      '-codec:a', 'libmp3lame', '-b:a', bitrate,
      '-f', 'mp3', 'pipe:1',
    ]);
    const chunks = [];
    let stderr = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => { stderr += c; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`));
    });
    ff.stdin.on('error', () => {});
    ff.stdin.end(mp3);
  });
}
