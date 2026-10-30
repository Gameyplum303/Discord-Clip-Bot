import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stt', 'worker.py');
const MAX_PENDING = 8;
const REQUEST_TIMEOUT_MS = 30_000;

// Keeps one long-lived Python faster-whisper process and talks to it over
// newline-delimited JSON. Restarts it if it dies.
export class SttClient {
  constructor({ python = process.env.PYTHON_PATH || 'python3', log = console } = {}) {
    this.python = python;
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.stopped = false;
    this.start();
  }

  start() {
    const proc = spawn(this.python, [WORKER], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.proc = proc;
    this.ready = new Promise((resolve) => { this.markReady = resolve; });

    createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.ready) {
        this.log.info?.(`Speech recognition ready (model: ${msg.model})`);
        this.markReady();
        return;
      }
      const req = this.pending.get(msg.id);
      if (!req) return;
      this.pending.delete(msg.id);
      clearTimeout(req.timer);
      if (msg.error) req.reject(new Error(msg.error));
      else req.resolve(msg.words);
    });

    proc.on('exit', (code, signal) => {
      for (const req of this.pending.values()) {
        clearTimeout(req.timer);
        req.reject(new Error('STT worker exited'));
      }
      this.pending.clear();
      if (this.stopped) return;
      this.log.error?.(`STT worker exited (${signal ?? code}), restarting in 2s`);
      setTimeout(() => this.start(), 2000);
    });
  }

  // pcm: 16 kHz mono s16le Buffer. Resolves to [{ word, start, end }].
  async transcribe(pcm, { hotwords = '' } = {}) {
    if (this.pending.size >= MAX_PENDING) throw new Error('STT backlog full, dropping audio window');
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('STT request timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, audio: pcm.toString('base64'), hotwords }) + '\n');
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }
}
