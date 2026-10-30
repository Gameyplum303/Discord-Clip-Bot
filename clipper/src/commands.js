import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import { normalizePhrase } from './triggers.js';

export const MAX_TRIGGERS = 25;
export const MAX_CLIP_SIDE_SEC = 30;

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('clip')
    .setDescription('Voice clipping bot')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('join')
        .setDescription('Join a voice channel and start listening for trigger words')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Voice channel to join (defaults to the one you are in)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        ),
    )
    .addSubcommand((s) => s.setName('leave').setDescription('Stop listening and leave the voice channel'))
    .addSubcommand((s) => s.setName('status').setDescription('Show what the bot is listening for and where clips go')),

  new SlashCommandBuilder()
    .setName('clipconfig')
    .setDescription('Configure the clipping bot')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup((g) =>
      g
        .setName('trigger')
        .setDescription('Words or phrases that start a clip')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a trigger word or short phrase')
            .addStringOption((o) =>
              o.setName('phrase').setDescription('e.g. "clip it"').setRequired(true).setMaxLength(50),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a trigger word or phrase')
            .addStringOption((o) =>
              o.setName('phrase').setDescription('Trigger to remove').setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((s) => s.setName('list').setDescription('List trigger words'))
        .addSubcommand((s) => s.setName('clear').setDescription('Remove all trigger words')),
    )
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('Set the text channel clips are posted to')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where to post MP3 clips')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('cooldown')
        .setDescription('Minimum time between clips')
        .addIntegerOption((o) =>
          o.setName('seconds').setDescription('Default 15').setRequired(true).setMinValue(0).setMaxValue(600),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('length')
        .setDescription('How much audio to keep before and after the trigger word')
        .addIntegerOption((o) =>
          o.setName('before').setDescription('Seconds before (default 10)').setRequired(true).setMinValue(1).setMaxValue(MAX_CLIP_SIDE_SEC),
        )
        .addIntegerOption((o) =>
          o.setName('after').setDescription('Seconds after (default 10)').setRequired(true).setMinValue(0).setMaxValue(MAX_CLIP_SIDE_SEC),
        ),
    ),
].map((c) => c.toJSON());

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });
const fmtTriggers = (t) => (t.length ? t.map((w) => `\`${w}\``).join(', ') : '_none yet: add one with `/clipconfig trigger add`_');

export function createCommandHandler({ store, listeners, startListening }) {
  async function handleClip(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const cfg = store.get(guild.id);

    if (sub === 'join') {
      const channel =
        interaction.options.getChannel('channel') ??
        (await guild.members.fetch(interaction.user.id)).voice.channel;
      if (!channel) return interaction.reply(ephemeral('Join a voice channel first, or pick one with the `channel` option.'));
      const me = guild.members.me;
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.ViewChannel)) {
        return interaction.reply(ephemeral(`I don't have permission to join ${channel}.`));
      }
      await interaction.deferReply();
      try {
        await startListening(guild, channel, interaction.channel);
      } catch (err) {
        return interaction.editReply(`Couldn't join ${channel}: ${err.message}`);
      }
      const where = cfg.channelId ? `<#${cfg.channelId}>` : `${interaction.channel} (set one with \`/clipconfig channel\`)`;
      return interaction.editReply(
        `🎙️ Listening in ${channel}. Saying ${fmtTriggers(cfg.triggers)} saves ${cfg.beforeSec}s before and ${cfg.afterSec}s after as an MP3 in ${where}.`,
      );
    }

    if (sub === 'leave') {
      const listener = listeners.get(guild.id);
      if (!listener) return interaction.reply(ephemeral("I'm not in a voice channel."));
      listener.destroy();
      return interaction.reply('👋 Stopped listening.');
    }

    if (sub === 'status') {
      const listener = listeners.get(guild.id);
      const s = listener?.status();
      return interaction.reply(
        ephemeral(
          [
            `**Voice channel:** ${s ? `${s.channel}${s.onCooldown ? ' (cooling down)' : ''}` : 'not connected'}`,
            `**Trigger words:** ${fmtTriggers(cfg.triggers)}`,
            `**Clips go to:** ${cfg.channelId ? `<#${cfg.channelId}>` : 'the channel `/clip join` was used in'}`,
            `**Clip length:** ${cfg.beforeSec}s before + ${cfg.afterSec}s after`,
            `**Cooldown:** ${cfg.cooldownSec}s`,
          ].join('\n'),
        ),
      );
    }
  }

  async function handleConfig(interaction) {
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const cfg = store.get(guildId);

    if (group === 'trigger') {
      if (sub === 'add') {
        const phrase = normalizePhrase(interaction.options.getString('phrase'));
        if (!phrase) return interaction.reply(ephemeral('A trigger needs at least one letter or number.'));
        if (phrase.split(' ').length > 4) return interaction.reply(ephemeral('Keep triggers to four words or fewer.'));
        if (cfg.triggers.includes(phrase)) return interaction.reply(ephemeral(`\`${phrase}\` is already a trigger.`));
        if (cfg.triggers.length >= MAX_TRIGGERS) return interaction.reply(ephemeral(`You can have up to ${MAX_TRIGGERS} triggers.`));
        const next = store.update(guildId, { triggers: [...cfg.triggers, phrase] });
        return interaction.reply(ephemeral(`✅ Added \`${phrase}\`. Triggers: ${fmtTriggers(next.triggers)}`));
      }
      if (sub === 'remove') {
        const phrase = normalizePhrase(interaction.options.getString('phrase'));
        if (!cfg.triggers.includes(phrase)) return interaction.reply(ephemeral(`\`${phrase}\` isn't a trigger.`));
        const next = store.update(guildId, { triggers: cfg.triggers.filter((t) => t !== phrase) });
        return interaction.reply(ephemeral(`🗑️ Removed \`${phrase}\`. Triggers: ${fmtTriggers(next.triggers)}`));
      }
      if (sub === 'list') return interaction.reply(ephemeral(`Triggers: ${fmtTriggers(cfg.triggers)}`));
      if (sub === 'clear') {
        store.update(guildId, { triggers: [] });
        return interaction.reply(ephemeral('All triggers removed.'));
      }
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      const perms = channel.permissionsFor(interaction.guild.members.me);
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
      if (!perms || !needed.every((p) => perms.has(p))) {
        return interaction.reply(ephemeral(`I need View Channel, Send Messages and Attach Files in ${channel}.`));
      }
      store.update(guildId, { channelId: channel.id });
      return interaction.reply(ephemeral(`📁 Clips will be posted in ${channel}.`));
    }

    if (sub === 'cooldown') {
      const seconds = interaction.options.getInteger('seconds');
      store.update(guildId, { cooldownSec: seconds });
      return interaction.reply(ephemeral(`⏱️ Cooldown set to ${seconds}s.`));
    }

    if (sub === 'length') {
      const beforeSec = interaction.options.getInteger('before');
      const afterSec = interaction.options.getInteger('after');
      store.update(guildId, { beforeSec, afterSec });
      return interaction.reply(ephemeral(`✂️ Clips will cover ${beforeSec}s before and ${afterSec}s after the trigger.`));
    }
  }

  return async function onInteraction(interaction) {
    if (!interaction.inGuild()) return;

    if (interaction.isAutocomplete() && interaction.commandName === 'clipconfig') {
      const typed = normalizePhrase(interaction.options.getFocused());
      const choices = store
        .get(interaction.guildId)
        .triggers.filter((t) => t.includes(typed))
        .slice(0, 25)
        .map((t) => ({ name: t, value: t }));
      return interaction.respond(choices);
    }

    if (!interaction.isChatInputCommand()) return;
    try {
      if (interaction.commandName === 'clip') await handleClip(interaction);
      else if (interaction.commandName === 'clipconfig') await handleConfig(interaction);
    } catch (err) {
      console.error('Command failed:', err);
      const msg = ephemeral('Something went wrong running that command.');
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  };
}
