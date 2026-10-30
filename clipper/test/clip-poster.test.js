import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ClipLibrary } from '../src/clip-library.js';
import { clipCaption, createClipActions, createClipPoster } from '../src/clip-poster.js';
import { DEFAULTS } from '../src/config-store.js';

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

const cfg = { ...DEFAULTS };
const hit = { trigger: 'clip', transcript: 'oh wow clip that @everyone' };

test('simple captions are unchanged from before', () => {
  assert.equal(clipCaption({ hit, userId: 'u', cfg, detailed: false }), '🎬 <@u> said **clip**: 10s before and 10s after.');
  assert.equal(clipCaption({ hit: null, userId: 'u', cfg, detailed: false }), '🎬 <@u> clipped the last 20s.');
});

test('detailed captions add the transcript, escaped', () => {
  const text = clipCaption({ hit: { trigger: 'clip', transcript: 'say *hi*' }, userId: 'u', cfg, durationSec: 20, detailed: true, clipId: 'abcd1234' });
  assert.match(text, /said by <@u>/);
  assert.match(text, /say \\\*hi\\\*/);
  assert.match(text, /clip `abcd1234`/);
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-'));
  const library = new ClipLibrary({ dir: path.join(root, 'clips'), indexPath: path.join(root, 'clips.json') });
  const sent = [];
  const channel = {
    id: 'text',
    guild: { id: 'g' },
    send: async (msg) => { sent.push(msg); return { id: 'm1', url: 'https://discord.com/channels/g/text/m1' }; },
  };
  return { library, sent, channel };
}

test('posts and saves a clip; detailed posts get buttons, simple ones do not', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { library, sent, channel } = setup();
  const save = createClipPoster({ library, log: {} });
  const pcm = Buffer.alloc(2 * 48_000 * 4);
  await save({ pcm, hit, userId: 'u', channel, cfg, voiceChannel: { id: 'vc' } });
  await save({ pcm, hit, userId: 'u', channel, cfg: { ...cfg, detailedPosts: true }, voiceChannel: { id: 'vc' } });

  assert.deepEqual(sent[0].components, []);
  const ids = sent[1].components[0].components.map((b) => b.data.custom_id);
  assert.equal(ids.length, 2);
  assert.match(ids[0], /^clip:trim:[a-f0-9]{8}:u$/);
  assert.deepEqual(sent[1].allowedMentions, { parse: [] });

  const saved = library.list('g');
  assert.equal(saved.length, 2);
  assert.equal(saved[0].messageId, 'm1');
  assert.equal(saved[0].voiceChannelId, 'vc');
});

test('storage limits apply after each new clip', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const { library, channel } = setup();
  const save = createClipPoster({ library, log: {} });
  const pcm = Buffer.alloc(48_000 * 4);
  for (let i = 0; i < 3; i++) await save({ pcm, hit, userId: 'u', channel, cfg: { ...cfg, maxClips: 2 } });
  assert.equal(library.list('g').length, 2);
});

function buttonInteraction({ customId, userId, canManage = false }) {
  const replies = [];
  return {
    replies,
    customId,
    guildId: 'g',
    user: { id: userId },
    memberPermissions: { has: () => canManage },
    isButton: () => true,
    isModalSubmit: () => false,
    deleted: false,
    message: { delete: async function () { this.deleted = true; } },
    reply: async (r) => replies.push(r),
    deferReply: async () => {},
    editReply: async (r) => replies.push(r),
    showModal: async (m) => replies.push({ modal: m }),
  };
}

test('only the speaker or a moderator can delete a clip', async () => {
  const { library } = setup();
  const clip = library.add({ id: library.newId(), guildId: 'g', durationSec: 20 }, Buffer.from('x'));
  const actions = createClipActions({ library, store: { get: () => cfg } });

  const stranger = buttonInteraction({ customId: `clip:delete:${clip.id}:owner`, userId: 'stranger' });
  await actions(stranger);
  assert.match(stranger.replies[0].content, /Only the person in the clip/);
  assert.equal(library.list('g').length, 1);

  const owner = buttonInteraction({ customId: `clip:delete:${clip.id}:owner`, userId: 'owner' });
  await actions(owner);
  assert.equal(owner.message.deleted, true);
  assert.equal(library.list('g').length, 0);

  const mod = buttonInteraction({ customId: 'clip:delete:-:owner', userId: 'mod', canManage: true });
  await actions(mod);
  assert.equal(mod.message.deleted, true);
});

test('trim rejects out-of-range times', async () => {
  const { library } = setup();
  const clip = library.add({ id: library.newId(), guildId: 'g', durationSec: 20 }, Buffer.from('x'));
  const actions = createClipActions({ library, store: { get: () => cfg } });
  for (const [start, end] of [['-1', '5'], ['5', '30'], ['5', '5.5'], ['abc', '10']]) {
    const i = buttonInteraction({ customId: `clip:trimmodal:${clip.id}:owner`, userId: 'owner' });
    i.isButton = () => false;
    i.isModalSubmit = () => true;
    i.fields = { getTextInputValue: (k) => (k === 'start' ? start : end) };
    await actions(i);
    assert.match(i.replies[0].content, /Pick a start and end/, `${start}-${end}`);
  }
});
