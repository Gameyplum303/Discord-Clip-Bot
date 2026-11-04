import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  triggers: [],
  channelId: null,
  cooldownSec: 15,
  beforeSec: 10,
  afterSec: 10,
  optedOut: [], // user ids whose voice is never recorded
  // Everything below is off by default so existing setups behave exactly as before.
  autoJoinChannelId: null, // join this voice channel whenever someone is in it
  detailedPosts: false, // speaker, transcript and trim/delete buttons on clip posts
  sound: false, // play a short chime in the call after each clip
  fuzzy: false, // accept near-miss spellings of trigger words
  triggerChannels: {}, // trigger phrase -> text channel id, overrides channelId
  maxClips: 0, // keep at most this many saved clips per server (0 = no limit)
  maxDays: 0, // delete saved clips older than this (0 = keep forever)
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
