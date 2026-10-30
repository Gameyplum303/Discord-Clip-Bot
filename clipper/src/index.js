import path from 'node:path';
import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { ConfigStore } from './config-store.js';
import { ClipLibrary } from './clip-library.js';
import { createClipActions, createClipPoster } from './clip-poster.js';
import { commandDefinitions, createCommandHandler } from './commands.js';
import { GuildListener } from './guild-listener.js';
import { SttClient } from './stt-client.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR || path.resolve('data');
const clipsDir = process.env.CLIPS_DIR || ''; // optional: keep every clip on disk (enables history, trim and storage limits)
const commandGuildId = process.env.COMMAND_GUILD_ID || ''; // optional: register commands instantly in one server

const store = new ConfigStore(path.join(dataDir, 'config.json'));
const stt = new SttClient();
const listeners = new Map(); // guildId -> GuildListener

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

const library = clipsDir ? new ClipLibrary({ dir: clipsDir, indexPath: path.join(dataDir, 'clips.json') }) : null;
const saveClip = createClipPoster({ library });
const onClipInteraction = createClipActions({ library, store });

// After someone uses /clip leave, don't auto-join straight back in.
const AUTO_JOIN_PAUSE_MS = 5 * 60 * 1000;
const autoJoinPausedUntil = new Map(); // guildId -> time
const joining = new Set(); // guildIds with a join in progress

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
    if (listener.manualLeave) autoJoinPausedUntil.set(guild.id, Date.now() + AUTO_JOIN_PAUSE_MS);
  };
  listeners.set(guild.id, listener);
  try {
    await listener.connect();
  } catch (err) {
    listener.destroy();
    throw err;
  }
}

const onCommand = createCommandHandler({ store, listeners, startListening, library });
client.on(Events.InteractionCreate, async (interaction) => {
  if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.inGuild()) {
    await onClipInteraction(interaction);
    return;
  }
  await onCommand(interaction);
});

const hasHumans = (channel) => channel.members.some((m) => !m.user.bot);

// Auto-join (off unless /clipconfig autojoin is set): join the chosen channel when someone is in it.
async function maybeAutoJoin(guild) {
  const { autoJoinChannelId } = store.get(guild.id);
  if (!autoJoinChannelId || listeners.has(guild.id) || joining.has(guild.id)) return;
  if (Date.now() < (autoJoinPausedUntil.get(guild.id) ?? 0)) return;
  const channel = guild.channels.cache.get(autoJoinChannelId);
  if (!channel?.isVoiceBased() || !hasHumans(channel)) return;
  const perms = channel.permissionsFor(guild.members.me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.Connect)) return;

  joining.add(guild.id);
  try {
    await startListening(guild, channel, null);
    console.log(`[${guild.name}] auto-joined ${channel.name}`);
  } catch (err) {
    console.error(`[${guild.name}] auto-join failed:`, err);
  } finally {
    joining.delete(guild.id);
  }
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  // Leave when everyone else has left the channel.
  const listener = listeners.get(oldState.guild.id);
  if (listener && oldState.channelId === listener.voiceChannel.id && !hasHumans(listener.voiceChannel)) {
    listener.destroy();
  }
  if (newState.channelId && !newState.member?.user.bot) maybeAutoJoin(newState.guild);
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  if (commandGuildId) await c.application.commands.set(commandDefinitions, commandGuildId);
  else await c.application.commands.set(commandDefinitions);
  console.log(`Registered slash commands${commandGuildId ? ` in server ${commandGuildId}` : ' globally'}`);
  for (const guild of c.guilds.cache.values()) maybeAutoJoin(guild);
});

// Apply age-based storage limits even on days with no new clips.
if (library) {
  setInterval(() => {
    for (const guildId of client.guilds.cache.keys()) library.enforceLimits(guildId, store.get(guildId));
  }, 60 * 60 * 1000).unref();
}

const shutdown = () => {
  for (const l of listeners.values()) l.destroy();
  stt.stop();
  client.destroy().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(token);
