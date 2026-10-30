import {
  AttachmentBuilder,
  ChannelType,
  escapeMarkdown,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import { normalizePhrase } from './triggers.js';
import { ClipLibrary } from './clip-library.js';

export const MAX_TRIGGERS = 25;
export const MAX_CLIP_SIDE_SEC = 30;
export const TEST_SECONDS = 10;

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
    .addSubcommand((s) => s.setName('status').setDescription('Show what the bot is listening for and where clips go'))
    .addSubcommand((s) => s.setName('now').setDescription('Save the last few seconds right now, no trigger word needed'))
    .addSubcommand((s) =>
      s.setName('test').setDescription(`Check what the bot hears you say over the next ${TEST_SECONDS} seconds`),
    )
    .addSubcommand((s) => s.setName('optout').setDescription('Never record your voice in this server'))
    .addSubcommand((s) => s.setName('optin').setDescription('Allow your voice in clips again'))
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Show recent saved clips')
        .addIntegerOption((o) => o.setName('count').setDescription('How many (default 10)').setMinValue(1).setMaxValue(25)),
    )
    .addSubcommand((s) =>
      s
        .setName('get')
        .setDescription('Get a saved clip by its id (shown in /clip list)')
        .addStringOption((o) => o.setName('id').setDescription('Clip id').setRequired(true).setMinLength(8).setMaxLength(8)),
    ),

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
        .addSubcommand((s) => s.setName('clear').setDescription('Remove all trigger words'))
        .addSubcommand((s) =>
          s
            .setName('channel')
            .setDescription('Send clips for one trigger to their own channel')
            .addStringOption((o) =>
              o.setName('phrase').setDescription('Trigger word or phrase').setRequired(true).setAutocomplete(true),
            )
            .addChannelOption((o) =>
              o
                .setName('channel')
                .setDescription('Leave empty to use the normal clips channel again')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice),
            ),
        ),
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
    )
    .addSubcommand((s) =>
      s
        .setName('autojoin')
        .setDescription('Join a voice channel automatically when someone is in it')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Leave empty to turn auto-join off')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('posts')
        .setDescription('Choose how clips are posted')
        .addStringOption((o) =>
          o
            .setName('style')
            .setDescription('Detailed adds who said it, a transcript, and trim/delete buttons')
            .setRequired(true)
            .addChoices({ name: 'simple (default)', value: 'simple' }, { name: 'detailed', value: 'detailed' }),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('sound')
        .setDescription('Play a short chime in the call after each clip')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Off by default').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('fuzzy')
        .setDescription('Also trigger on near misses, like "clipp" for "clip"')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Off by default').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('storage')
        .setDescription('Limit how many saved clips are kept; older ones are deleted automatically')
        .addIntegerOption((o) =>
          o.setName('max_clips').setDescription('Keep at most this many (0 = no limit)').setRequired(true).setMinValue(0).setMaxValue(100_000),
        )
        .addIntegerOption((o) =>
          o.setName('max_days').setDescription('Delete clips older than this many days (0 = keep forever)').setRequired(true).setMinValue(0).setMaxValue(3650),
        ),
    ),
].map((c) => c.toJSON());

const canJoin = (perms) =>
  Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.Connect));
// Never ping anyone from a reply, even if a transcript contains @everyone.
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const fmtTriggers = (t) => (t.length ? t.map((w) => `\`${w}\``).join(', ') : '_none yet: add one with `/clipconfig trigger add`_');

const sendPerms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
const canPost = (channel, me) => {
  const perms = channel.permissionsFor(me);
  return Boolean(perms && sendPerms.every((p) => perms.has(p)));
};

export function createCommandHandler({ store, listeners, startListening, library = null }) {
  // Saved clips are only visible to people who could have been in the call they came from.
  function canSeeClip(guild, member, clip) {
    const vc = clip.voiceChannelId && guild.channels.cache.get(clip.voiceChannelId);
    if (vc) return canJoin(vc.permissionsFor(member));
    return Boolean(member.permissions?.has(PermissionFlagsBits.ManageGuild));
  }

  async function handleClip(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const cfg = store.get(guild.id);

    if (sub === 'join') {
      const member = await guild.members.fetch(interaction.user.id);
      const channel = interaction.options.getChannel('channel') ?? member.voice.channel;
      if (!channel) return interaction.reply(ephemeral('Join a voice channel first, or pick one with the `channel` option.'));
      // Only record channels the person asking could join and listen to themselves,
      // so nobody can use the bot to listen in on a private channel.
      if (!canJoin(channel.permissionsFor(member))) {
        return interaction.reply(ephemeral(`You need access to ${channel} to start clipping there.`));
      }
      if (!canJoin(channel.permissionsFor(guild.members.me))) {
        return interaction.reply(ephemeral(`I don't have permission to join ${channel}.`));
      }
      // Moving the bot out of a call someone else started needs the same access to that call.
      const current = listeners.get(guild.id);
      if (current && current.voiceChannel.id !== channel.id && !canJoin(current.voiceChannel.permissionsFor(member))) {
        return interaction.reply(ephemeral("I'm already clipping another channel you don't have access to."));
      }
      await interaction.deferReply();
      try {
        await startListening(guild, channel, interaction.channel);
      } catch (err) {
        console.error(`Failed to join voice channel ${channel.id} in ${guild.id}:`, err);
        return interaction.editReply(`Couldn't join ${channel}. Check my permissions and try again.`);
      }
      const where = cfg.channelId ? `<#${cfg.channelId}>` : `${interaction.channel} (set one with \`/clipconfig channel\`)`;
      return interaction.editReply(
        `🎙️ Listening in ${channel}. Saying ${fmtTriggers(cfg.triggers)} saves ${cfg.beforeSec}s before and ${cfg.afterSec}s after as an MP3 in ${where}.`,
      );
    }

    if (sub === 'leave') {
      const listener = listeners.get(guild.id);
      if (!listener) return interaction.reply(ephemeral("I'm not in a voice channel."));
      const member = await guild.members.fetch(interaction.user.id);
      if (!canJoin(listener.voiceChannel.permissionsFor(member))) {
        return interaction.reply(ephemeral("You need access to the channel I'm in to stop me."));
      }
      listener.manualLeave = true;
      listener.destroy();
      return interaction.reply('👋 Stopped listening.');
    }

    if (sub === 'optout' || sub === 'optin') {
      const optedOut = cfg.optedOut.filter((id) => id !== interaction.user.id);
      if (sub === 'optout') {
        store.update(guild.id, { optedOut: [...optedOut, interaction.user.id] });
        listeners.get(guild.id)?.forgetUser(interaction.user.id);
        return interaction.reply(
          ephemeral("🔇 You're opted out. I won't record or transcribe your voice in this server, and I've dropped anything I had buffered. Clips already posted aren't affected."),
        );
      }
      store.update(guild.id, { optedOut });
      return interaction.reply(ephemeral('🔊 Your voice can be included in clips again.'));
    }

    if (sub === 'now' || sub === 'test') {
      const listener = listeners.get(guild.id);
      if (!listener) return interaction.reply(ephemeral("I'm not in a voice channel. Use `/clip join` first."));
      // Only people actually in the call can clip it or test with it.
      const member = await guild.members.fetch(interaction.user.id);
      if (member.voice.channelId !== listener.voiceChannel.id) {
        return interaction.reply(ephemeral(`Join ${listener.voiceChannel} to use this.`));
      }

      if (sub === 'now') {
        if (!listener.clipNow(interaction.user.id)) {
          return interaction.reply(ephemeral('You just made a clip. Wait a few seconds and try again.'));
        }
        return interaction.reply(ephemeral(`✂️ Saving the last ${cfg.beforeSec + cfg.afterSec}s now.`));
      }

      if (cfg.optedOut.includes(interaction.user.id)) {
        return interaction.reply(ephemeral("You're opted out, so I can't hear you. Use `/clip optin` first."));
      }
      await interaction.reply(
        ephemeral(`🎧 Listening to you for ${TEST_SECONDS}s. Say your trigger words now: ${fmtTriggers(cfg.triggers)}`),
      );
      const heard = await listener.runTest(interaction.user.id, TEST_SECONDS * 1000);
      const matched = [...new Set(heard.map((h) => h.trigger).filter(Boolean))];
      const transcript = escapeMarkdown(heard.map((h) => h.text).join(' ').slice(0, 1500));
      return interaction.editReply({
        allowedMentions: { parse: [] },
        content: [
          transcript ? `**I heard:** ${transcript}` : "**I didn't hear anything.** Check your mic isn't muted and that you're not opted out.",
          matched.length
            ? `✅ That would trigger a clip: ${matched.map((t) => `\`${t}\``).join(', ')}`
            : '❌ No trigger words heard. Try saying them more clearly, or pick words that are harder to mishear.',
        ].join('\n'),
      });
    }

    if (sub === 'list' || sub === 'get') {
      if (!library) return interaction.reply(ephemeral('Clip history is off because clips aren\'t being saved to disk (set `CLIPS_DIR`).'));
      const member = await guild.members.fetch(interaction.user.id);

      if (sub === 'list') {
        const count = interaction.options.getInteger('count') ?? 10;
        const clips = library.list(guild.id).filter((c) => canSeeClip(guild, member, c)).slice(0, count);
        if (!clips.length) return interaction.reply(ephemeral('No saved clips yet.'));
        const lines = clips.map((c) => {
          const what = c.trigger ? `**${c.trigger}**` : 'manual';
          const link = c.messageUrl ? ` · [post](${c.messageUrl})` : '';
          return `\`${c.id}\` ${what} by <@${c.userId}> · <t:${Math.floor(c.createdAt / 1000)}:R>${link}`;
        });
        return interaction.reply(ephemeral(`${lines.join('\n')}\n-# Use \`/clip get id:<id>\` to download one.`));
      }

      const id = interaction.options.getString('id').trim().toLowerCase();
      const clip = ClipLibrary.isValidId(id) ? library.get(guild.id, id) : null;
      if (!clip || !canSeeClip(guild, member, clip)) return interaction.reply(ephemeral(`No clip \`${id.replace(/`/g, '')}\` found.`));
      const what = clip.trigger ? `**${clip.trigger}**` : 'a manual clip';
      return interaction.reply({
        ...ephemeral(`🎬 ${what} by <@${clip.userId}>, <t:${Math.floor(clip.createdAt / 1000)}:R>`),
        files: [new AttachmentBuilder(library.read(clip), { name: clip.file })],
      });
    }

    if (sub === 'status') {
      const listener = listeners.get(guild.id);
      const s = listener?.status();
      const member = await guild.members.fetch(interaction.user.id);
      const visible = s && s.channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel);
      return interaction.reply(
        ephemeral(
          [
            `**Voice channel:** ${s ? `${visible ? s.channel : 'a channel you can\'t see'}${s.onCooldown ? ' (cooling down)' : ''}` : 'not connected'}`,
            `**Trigger words:** ${fmtTriggers(cfg.triggers)}`,
            `**Clips go to:** ${cfg.channelId ? `<#${cfg.channelId}>` : 'the channel `/clip join` was used in'}`,
            `**Clip length:** ${cfg.beforeSec}s before + ${cfg.afterSec}s after`,
            `**Cooldown:** ${cfg.cooldownSec}s`,
            `**Auto-join:** ${cfg.autoJoinChannelId ? `<#${cfg.autoJoinChannelId}>` : 'off'} · **Posts:** ${cfg.detailedPosts ? 'detailed' : 'simple'} · **Chime:** ${cfg.sound ? 'on' : 'off'} · **Fuzzy:** ${cfg.fuzzy ? 'on' : 'off'}`,
            `**Storage:** ${cfg.maxClips ? `${cfg.maxClips} clips max` : 'no clip limit'}, ${cfg.maxDays ? `${cfg.maxDays} days` : 'kept forever'}`,
            `**Your voice:** ${cfg.optedOut.includes(interaction.user.id) ? 'opted out (`/clip optin` to undo)' : 'included (`/clip optout` to stop)'}`,
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
        const { [phrase]: _dropped, ...triggerChannels } = cfg.triggerChannels;
        const next = store.update(guildId, { triggers: cfg.triggers.filter((t) => t !== phrase), triggerChannels });
        return interaction.reply(ephemeral(`🗑️ Removed \`${phrase}\`. Triggers: ${fmtTriggers(next.triggers)}`));
      }
      if (sub === 'list') return interaction.reply(ephemeral(`Triggers: ${fmtTriggers(cfg.triggers)}`));
      if (sub === 'channel') {
        const phrase = normalizePhrase(interaction.options.getString('phrase'));
        if (!cfg.triggers.includes(phrase)) return interaction.reply(ephemeral(`\`${phrase}\` isn't a trigger. Add it first.`));
        const channel = interaction.options.getChannel('channel');
        const { [phrase]: _old, ...rest } = cfg.triggerChannels;
        if (!channel) {
          store.update(guildId, { triggerChannels: rest });
          return interaction.reply(ephemeral(`\`${phrase}\` clips will go to the normal clips channel.`));
        }
        if (!canPost(channel, interaction.guild.members.me)) {
          return interaction.reply(ephemeral(`I need View Channel, Send Messages and Attach Files in ${channel}.`));
        }
        store.update(guildId, { triggerChannels: { ...rest, [phrase]: channel.id } });
        return interaction.reply(ephemeral(`📁 \`${phrase}\` clips will be posted in ${channel}.`));
      }
      if (sub === 'clear') {
        store.update(guildId, { triggers: [], triggerChannels: {} });
        return interaction.reply(ephemeral('All triggers removed.'));
      }
    }

    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      if (!canPost(channel, interaction.guild.members.me)) {
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

    if (sub === 'autojoin') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        store.update(guildId, { autoJoinChannelId: null });
        return interaction.reply(ephemeral('Auto-join is off.'));
      }
      if (!canJoin(channel.permissionsFor(interaction.guild.members.me))) {
        return interaction.reply(ephemeral(`I don't have permission to join ${channel}.`));
      }
      store.update(guildId, { autoJoinChannelId: channel.id });
      const note = cfg.channelId ? '' : ' Set a clips channel with `/clipconfig channel` too, or auto-joined clips will have nowhere to go.';
      return interaction.reply(ephemeral(`🔁 I'll join ${channel} whenever someone is in it.${note}`));
    }

    if (sub === 'posts') {
      const detailed = interaction.options.getString('style') === 'detailed';
      store.update(guildId, { detailedPosts: detailed });
      return interaction.reply(
        ephemeral(detailed ? '📝 Clip posts will show who said it, what was said, and Trim/Delete buttons.' : '📝 Clip posts are back to the simple style.'),
      );
    }

    if (sub === 'sound') {
      const on = interaction.options.getBoolean('enabled');
      store.update(guildId, { sound: on });
      listeners.get(guildId)?.setSound(on);
      return interaction.reply(ephemeral(on ? '🔔 I\'ll play a short chime in the call after each clip.' : '🔕 Clip chime is off.'));
    }

    if (sub === 'fuzzy') {
      const on = interaction.options.getBoolean('enabled');
      store.update(guildId, { fuzzy: on });
      return interaction.reply(
        ephemeral(on ? '🔤 Fuzzy matching is on: near misses like "clipp" for "clip" will trigger too.' : '🔤 Fuzzy matching is off: only exact trigger words count.'),
      );
    }

    if (sub === 'storage') {
      const maxClips = interaction.options.getInteger('max_clips');
      const maxDays = interaction.options.getInteger('max_days');
      store.update(guildId, { maxClips, maxDays });
      const removed = library ? library.enforceLimits(guildId, { maxClips, maxDays }).length : 0;
      const parts = [maxClips ? `at most ${maxClips} clips` : 'any number of clips', maxDays ? `for ${maxDays} days` : 'forever'];
      return interaction.reply(
        ephemeral(`🗄️ I'll keep ${parts[0]} ${parts[1]}.${removed ? ` Removed ${removed} old clip(s) just now.` : ''}`),
      );
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
