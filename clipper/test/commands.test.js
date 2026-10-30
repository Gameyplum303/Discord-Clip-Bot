import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { createCommandHandler } from '../src/commands.js';
import { DEFAULTS } from '../src/config-store.js';

const ALL = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect];
const perms = (granted) => ({ has: (p) => granted.includes(p) });

// A voice channel where `access` maps member ids to the permissions they hold.
const voiceChannel = (id, access) => ({ id, toString: () => `<#${id}>`, permissionsFor: (m) => perms(access[m.id] ?? []) });

function setup({ access, listening = null }) {
  const me = { id: 'bot' };
  const member = { id: 'user', voice: { channel: null } };
  const guild = { id: 'g', members: { me, fetch: async () => member } };
  const listeners = new Map();
  if (listening) listeners.set('g', { voiceChannel: listening, destroy() { this.destroyed = true; }, status: () => ({ channel: listening }) });
  const joined = [];
  const handler = createCommandHandler({
    store: { get: () => ({ ...DEFAULTS }) },
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
  return { run, joined, listeners };
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
