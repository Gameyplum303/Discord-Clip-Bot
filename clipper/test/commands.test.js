import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { createCommandHandler } from '../src/commands.js';
import { DEFAULTS } from '../src/config-store.js';

const ALL = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect];
const perms = (granted) => ({ has: (p) => granted.includes(p) });

// A voice channel where `access` maps member ids to the permissions they hold.
const voiceChannel = (id, access) => ({ id, toString: () => `<#${id}>`, permissionsFor: (m) => perms(access[m.id] ?? []) });

function setup({ access, listening = null, inChannel = null, cfg = {} }) {
  const me = { id: 'bot' };
  const member = { id: 'user', voice: { channel: null, channelId: inChannel } };
  const guild = { id: 'g', members: { me, fetch: async () => member } };
  const listeners = new Map();
  const calls = [];
  if (listening) {
    listeners.set('g', {
      voiceChannel: listening,
      destroy() { this.destroyed = true; },
      status: () => ({ channel: listening }),
      clipNow: (id) => { calls.push(['now', id]); return true; },
      forgetUser: (id) => calls.push(['forget', id]),
    });
  }
  const saved = { ...DEFAULTS, ...cfg };
  const joined = [];
  const handler = createCommandHandler({
    store: { get: () => ({ ...saved }), update: (_g, c) => Object.assign(saved, c) },
    listeners,
    startListening: async (_g, ch) => joined.push(ch.id),
  });
  const run = async (sub, channel = null) => {
    const replies = [];
    await handler({
      inGuild: () => true,
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      commandName: 'clip',
      guild,
      user: { id: 'user' },
      channel: { id: 'text' },
      options: { getSubcommand: () => sub, getChannel: () => channel },
      reply: async (r) => replies.push(r),
      deferReply: async () => {},
      editReply: async (r) => replies.push(r),
    });
    return replies.map((r) => (typeof r === 'string' ? r : r.content)).join('\n');
  };
  return { run, joined, listeners, calls, saved, handler };
}

test('refuses to join a channel the user cannot access', async () => {
  const secret = voiceChannel('secret', { bot: ALL, user: [] });
  const { run, joined } = setup({ access: {} });
  const reply = await run('join', secret);
  assert.match(reply, /You need access/);
  assert.deepEqual(joined, []);
});

test('joins a channel both the user and bot can access', async () => {
  const lounge = voiceChannel('lounge', { bot: ALL, user: ALL });
  const { run, joined } = setup({ access: {} });
  await run('join', lounge);
  assert.deepEqual(joined, ['lounge']);
});

test('refuses to move the bot out of a channel the user cannot access', async () => {
  const secret = voiceChannel('secret', { bot: ALL, user: [] });
  const lounge = voiceChannel('lounge', { bot: ALL, user: ALL });
  const { run, joined } = setup({ access: {}, listening: secret });
  assert.match(await run('join', lounge), /already clipping another channel/);
  assert.deepEqual(joined, []);
});

test('leave and status respect channel access', async () => {
  const secret = voiceChannel('secret', { bot: ALL, user: [] });
  const { run, listeners } = setup({ access: {}, listening: secret });
  assert.match(await run('leave'), /You need access/);
  assert.equal(listeners.get('g').destroyed, undefined);
  const status = await run('status');
  assert.match(status, /a channel you can't see/);
  assert.doesNotMatch(status, /secret/);
});

test('/clip now only works for people in the call', async () => {
  const lounge = voiceChannel('lounge', { bot: ALL, user: ALL });
  const outside = setup({ access: {}, listening: lounge, inChannel: null });
  assert.match(await outside.run('now'), /Join/);
  assert.deepEqual(outside.calls, []);

  const inside = setup({ access: {}, listening: lounge, inChannel: 'lounge' });
  assert.match(await inside.run('now'), /Saving the last 20s/);
  assert.deepEqual(inside.calls, [['now', 'user']]);
});

test('/clip optout stores the choice and drops buffered audio; optin undoes it', async () => {
  const lounge = voiceChannel('lounge', { bot: ALL, user: ALL });
  const { run, calls, saved } = setup({ access: {}, listening: lounge });
  await run('optout');
  assert.deepEqual(saved.optedOut, ['user']);
  assert.deepEqual(calls, [['forget', 'user']]);
  await run('optout');
  assert.deepEqual(saved.optedOut, ['user'], 'no duplicates');
  await run('optin');
  assert.deepEqual(saved.optedOut, []);
});

test('replies never ping anyone', async () => {
  const lounge = voiceChannel('lounge', { bot: ALL, user: ALL });
  const { handler } = setup({ access: {}, listening: lounge });
  const replies = [];
  await handler({
    inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => true,
    commandName: 'clip', guild: { id: 'g', members: { me: { id: 'bot' }, fetch: async () => ({ id: 'user', voice: {} }) } },
    user: { id: 'user' }, channel: { id: 'text' },
    options: { getSubcommand: () => 'status', getChannel: () => null },
    reply: async (r) => replies.push(r),
  });
  assert.deepEqual(replies[0].allowedMentions, { parse: [] });
});

// Runs a /clipconfig command against an in-memory store.
async function runConfig(saved, { group = null, sub, options = {} }, { library = null, listeners = new Map() } = {}) {
  const handler = createCommandHandler({
    store: { get: () => ({ ...saved }), update: (_g, c) => Object.assign(saved, c) },
    listeners,
    startListening: async () => {},
    library,
  });
  const replies = [];
  const me = { id: 'bot' };
  await handler({
    inGuild: () => true,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    commandName: 'clipconfig',
    guild: { id: 'g', members: { me } },
    user: { id: 'admin' },
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
      getString: (k) => options[k] ?? null,
      getChannel: (k) => options[k] ?? null,
      getInteger: (k) => options[k] ?? null,
      getBoolean: (k) => options[k] ?? null,
    },
    reply: async (r) => replies.push(r.content ?? r),
  });
  return replies.join('\n');
}

const textChannel = (id) => ({ id, toString: () => `<#${id}>`, permissionsFor: () => perms(Object.values(PermissionFlagsBits)) });

test('new settings are all off by default', () => {
  assert.equal(DEFAULTS.autoJoinChannelId, null);
  assert.equal(DEFAULTS.detailedPosts, false);
  assert.equal(DEFAULTS.sound, false);
  assert.equal(DEFAULTS.fuzzy, false);
  assert.deepEqual(DEFAULTS.triggerChannels, {});
  assert.equal(DEFAULTS.maxClips, 0);
  assert.equal(DEFAULTS.maxDays, 0);
});

test('per-trigger channel is set, cleared, and dropped with its trigger', async () => {
  const saved = { ...DEFAULTS, triggers: ['clip', 'wow'] };
  await runConfig(saved, { group: 'trigger', sub: 'channel', options: { phrase: 'Wow!', channel: textChannel('c1') } });
  assert.deepEqual(saved.triggerChannels, { wow: 'c1' });
  assert.match(await runConfig(saved, { group: 'trigger', sub: 'channel', options: { phrase: 'nope', channel: textChannel('c1') } }), /isn't a trigger/);
  await runConfig(saved, { group: 'trigger', sub: 'remove', options: { phrase: 'wow' } });
  assert.deepEqual(saved.triggerChannels, {});
  assert.deepEqual(saved.triggers, ['clip']);
});

test('toggles update settings and the live call', async () => {
  const saved = { ...DEFAULTS };
  const soundCalls = [];
  const listeners = new Map([['g', { setSound: (on) => soundCalls.push(on) }]]);
  await runConfig(saved, { sub: 'sound', options: { enabled: true } }, { listeners });
  await runConfig(saved, { sub: 'fuzzy', options: { enabled: true } });
  await runConfig(saved, { sub: 'posts', options: { style: 'detailed' } });
  await runConfig(saved, { sub: 'storage', options: { max_clips: 50, max_days: 7 } });
  await runConfig(saved, { sub: 'autojoin', options: { channel: voiceChannel('vc', { bot: ALL }) } });
  assert.deepEqual(soundCalls, [true]);
  assert.equal(saved.fuzzy, true);
  assert.equal(saved.detailedPosts, true);
  assert.equal(saved.maxClips, 50);
  assert.equal(saved.maxDays, 7);
  assert.equal(saved.autoJoinChannelId, 'vc');
  await runConfig(saved, { sub: 'autojoin', options: {} });
  assert.equal(saved.autoJoinChannelId, null);
});

test('/clip list and /clip get hide clips from calls the user cannot access', async () => {
  const clips = [
    { id: 'aaaaaaaa', guildId: 'g', voiceChannelId: 'open', userId: 'x', createdAt: 2, file: 'a.mp3' },
    { id: 'bbbbbbbb', guildId: 'g', voiceChannelId: 'secret', userId: 'x', createdAt: 1, file: 'b.mp3' },
  ];
  const library = {
    list: () => clips,
    get: (_g, id) => clips.find((c) => c.id === id) ?? null,
    read: () => Buffer.from('mp3'),
  };
  const chans = new Map([
    ['open', voiceChannel('open', { user: ALL })],
    ['secret', voiceChannel('secret', { user: [] })],
  ]);
  const handler = createCommandHandler({ store: { get: () => ({ ...DEFAULTS }) }, listeners: new Map(), startListening: async () => {}, library });
  const ask = async (sub, opts = {}) => {
    const replies = [];
    await handler({
      inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => true, commandName: 'clip',
      guild: { id: 'g', channels: { cache: chans }, members: { me: { id: 'bot' }, fetch: async () => ({ id: 'user', voice: {} }) } },
      user: { id: 'user' }, channel: { id: 't' },
      options: { getSubcommand: () => sub, getInteger: () => null, getString: (k) => opts[k] },
      reply: async (r) => replies.push(r),
    });
    return replies[0];
  };
  const list = await ask('list');
  assert.match(list.content, /aaaaaaaa/);
  assert.doesNotMatch(list.content, /bbbbbbbb/);
  assert.equal((await ask('get', { id: 'aaaaaaaa' })).files.length, 1);
  assert.match((await ask('get', { id: 'bbbbbbbb' })).content, /No clip/);
  assert.match((await ask('get', { id: '../../xx' })).content, /No clip/);
});
