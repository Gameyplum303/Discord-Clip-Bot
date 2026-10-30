import fs from 'node:fs/promises';
import path from 'node:path';
import { AttachmentBuilder, Client, Events, GatewayIntentBits } from 'discord.js';
import { ConfigStore } from './config-store.js';
import { commandDefinitions, createCommandHandler } from './commands.js';
import { GuildListener } from './guild-listener.js';
import { encodeMp3 } from './mp3.js';
import { SttClient } from './stt-client.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR || path.resolve('data');
const clipsDir = process.env.CLIPS_DIR || ''; // optional: also keep a copy of every clip on disk
const commandGuildId = process.env.COMMAND_GUILD_ID || ''; // optional: register commands instantly in one server

const store = new ConfigStore(path.join(dataDir, 'config.json'));
const stt = new SttClient();
const listeners = new Map(); // guildId -> GuildListener

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

async function saveClip({ pcm, hit, userId, channel, cfg }) {
  const mp3 = await encodeMp3(pcm);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `clip-${hit.trigger.replace(/\s+/g, '-')}-${stamp}.mp3`;

  if (clipsDir) {
    await fs.mkdir(clipsDir, { recursive: true });
    await fs.writeFile(path.join(clipsDir, name), mp3);
  }
  await channel.send({
    content: `🎬 <@${userId}> said **${hit.trigger}**: ${cfg.beforeSec}s before and ${cfg.afterSec}s after.`,
    files: [new AttachmentBuilder(mp3, { name })],
    allowedMentions: { parse: [] },
  });
}

async function startListening(guild, voiceChannel, textChannel) {
  listeners.get(guild.id)?.destroy();
  const listener = new GuildListener({
    guild,
    voiceChannel,
    fallbackTextChannel: textChannel,
    config: () => store.get(guild.id),
    stt,
    saveClip,
  });
  listener.onDestroy = () => {
    if (listeners.get(guild.id) === listener) listeners.delete(guild.id);
  };
  listeners.set(guild.id, listener);
  try {
    await listener.connect();
  } catch (err) {
    listener.destroy();
    throw err;
  }
}

client.on(Events.InteractionCreate, createCommandHandler({ store, listeners, startListening }));

// Leave when everyone else has left the channel.
client.on(Events.VoiceStateUpdate, (oldState) => {
  const listener = listeners.get(oldState.guild.id);
  if (!listener || oldState.channelId !== listener.voiceChannel.id) return;
  const humans = listener.voiceChannel.members.filter((m) => !m.user.bot);
  if (humans.size === 0) listener.destroy();
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  if (commandGuildId) await c.application.commands.set(commandDefinitions, commandGuildId);
  else await c.application.commands.set(commandDefinitions);
  console.log(`Registered slash commands${commandGuildId ? ` in server ${commandGuildId}` : ' globally'}`);
});

const shutdown = () => {
  for (const l of listeners.values()) l.destroy();
  stt.stop();
  client.destroy().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(token);
