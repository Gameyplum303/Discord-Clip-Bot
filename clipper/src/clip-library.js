import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[a-f0-9]{8}$/;

// Saved clips on disk plus a JSON index of who/what/where for each one.
// Only files this index created are ever read or deleted.
export class ClipLibrary {
  constructor({ dir, indexPath }) {
    this.dir = path.resolve(dir);
    this.indexPath = indexPath;
    this.clips = [];
    try {
      this.clips = JSON.parse(fs.readFileSync(indexPath, 'utf8')).clips ?? [];
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Could not read ${indexPath}, starting fresh:`, err.message);
    }
  }

  static isValidId(id) {
    return typeof id === 'string' && ID_PATTERN.test(id);
  }

  newId() {
    let id;
    do id = crypto.randomBytes(4).toString('hex');
    while (this.clips.some((c) => c.id === id));
    return id;
  }

  // Resolve a clip file name inside the clips folder, refusing anything that escapes it.
  filePath(file) {
    const full = path.resolve(this.dir, file);
    if (path.dirname(full) !== this.dir) throw new Error('Invalid clip path');
    return full;
  }

  add(record, mp3) {
    fs.mkdirSync(this.dir, { recursive: true });
    // Readable name for anyone browsing the folder; the id keeps it unique.
    const label = String(record.trigger ?? 'manual').replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'clip';
    const stamp = new Date(record.createdAt ?? Date.now()).toISOString().replace(/[:.]/g, '-');
    const file = `clip-${label}-${stamp}-${record.id}.mp3`;
    fs.writeFileSync(this.filePath(file), mp3);
    const clip = { ...record, file, createdAt: record.createdAt ?? Date.now() };
    this.clips.push(clip);
    this.save();
    return clip;
  }

  get(guildId, id) {
    return this.clips.find((c) => c.guildId === guildId && c.id === id) ?? null;
  }

  list(guildId) {
    return this.clips.filter((c) => c.guildId === guildId).sort((a, b) => b.createdAt - a.createdAt);
  }

  read(clip) {
    return fs.readFileSync(this.filePath(clip.file));
  }

  update(clip, changes) {
    Object.assign(clip, changes);
    this.save();
  }

  // Replace a clip's audio (after trimming), keeping its id.
  replaceAudio(clip, mp3, durationSec) {
    const file = clip.file.replace(/(-trim-[a-z0-9]+)?\.mp3$/, `-trim-${Date.now().toString(36)}.mp3`);
    fs.writeFileSync(this.filePath(file), mp3);
    this.unlink(clip.file);
    this.update(clip, { file, durationSec });
  }

  remove(clip) {
    this.unlink(clip.file);
    this.clips = this.clips.filter((c) => c !== clip);
    this.save();
  }

  // Delete the oldest clips beyond maxClips and any older than maxDays (0 = no limit).
  // Returns the removed records.
  enforceLimits(guildId, { maxClips = 0, maxDays = 0 }, nowMs = Date.now()) {
    const mine = this.list(guildId);
    const doomed = new Set();
    if (maxDays > 0) for (const c of mine) if (nowMs - c.createdAt > maxDays * DAY_MS) doomed.add(c);
    if (maxClips > 0) for (const c of mine.slice(maxClips)) doomed.add(c);
    if (!doomed.size) return [];
    for (const c of doomed) this.unlink(c.file);
    this.clips = this.clips.filter((c) => !doomed.has(c));
    this.save();
    return [...doomed];
  }

  unlink(file) {
    try {
      fs.unlinkSync(this.filePath(file));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Could not delete clip ${file}:`, err.message);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    const tmp = `${this.indexPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ clips: this.clips }, null, 2));
    fs.renameSync(tmp, this.indexPath);
  }
}
