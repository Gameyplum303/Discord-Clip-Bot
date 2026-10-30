import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  triggers: [],
  channelId: null,
  cooldownSec: 15,
  beforeSec: 10,
  afterSec: 10,
  optedOut: [], // user ids whose voice is never recorded
});

// Per-server settings, saved to a JSON file so they survive restarts.
export class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.guilds = {};
    try {
      this.guilds = JSON.parse(fs.readFileSync(filePath, 'utf8')).guilds ?? {};
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`Could not read ${filePath}, starting fresh:`, err.message);
    }
  }

  get(guildId) {
    return { ...DEFAULTS, ...this.guilds[guildId] };
  }

  update(guildId, changes) {
    const next = { ...this.get(guildId), ...changes };
    this.guilds[guildId] = next;
    this.save();
    return next;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ guilds: this.guilds }, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}
