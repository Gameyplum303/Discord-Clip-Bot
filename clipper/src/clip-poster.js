import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} from 'discord.js';
import { ClipLibrary } from './clip-library.js';
import { SAMPLE_RATE, CHANNELS } from './audio-timeline.js';
import { encodeMp3, trimMp3 } from './mp3.js';

const NO_PINGS = { parse: [] };
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS });
const MIN_TRIM_SEC = 1;

function clipName(hit, createdAt) {
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  return `clip-${hit ? hit.trigger.replace(/\s+/g, '-') : 'manual'}-${stamp}.mp3`;
}

export function clipCaption({ hit, userId, cfg, durationSec, detailed, clipId, trimmed = false }) {
  if (!detailed) {
    return hit
      ? `🎬 <@${userId}> said **${hit.trigger}**: ${cfg.beforeSec}s before and ${cfg.afterSec}s after.`
      : `🎬 <@${userId}> clipped the last ${cfg.beforeSec + cfg.afterSec}s.`;
  }
  const lines = [hit ? `🎬 **${hit.trigger}**, said by <@${userId}>` : `🎬 Clipped by <@${userId}>`];
  if (hit?.transcript) lines.push(`> ${escapeMarkdown(hit.transcript.slice(0, 300))}`);
  lines.push(`-# ${Math.round(durationSec)}s${trimmed ? ' (trimmed)' : ''}${clipId ? ` · clip \`${clipId}\`` : ''}`);
  return lines.join('\n');
}

// Buttons carry the clip id and the person it belongs to, so a click can be
// checked without trusting anything else from the client.
function clipButtons({ clipId, ownerId, canTrim }) {
  const row = new ActionRowBuilder();
  if (canTrim) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`clip:trim:${clipId}:${ownerId}`).setLabel('Trim').setEmoji('✂️').setStyle(ButtonStyle.Secondary),
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(`clip:delete:${clipId ?? '-'}:${ownerId}`).setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  return [row];
}

// Encodes, saves and posts a clip. `library` is null when clips aren't kept on disk.
export function createClipPoster({ library, log = console }) {
  return async function saveClip({ pcm, hit, userId, channel, cfg, voiceChannel }) {
    const mp3 = await encodeMp3(pcm);
    const createdAt = Date.now();
    const durationSec = pcm.length / (SAMPLE_RATE * CHANNELS * 2);

    let clip = null;
    if (library) {
      clip = library.add(
        {
          id: library.newId(),
          guildId: channel.guild.id,
          voiceChannelId: voiceChannel?.id ?? null,
          userId,
          trigger: hit?.trigger ?? null,
          transcript: hit?.transcript ?? null,
          durationSec,
          createdAt,
        },
        mp3,
      );
    }

    const detailed = Boolean(cfg.detailedPosts);
    const message = await channel.send({
      content: clipCaption({ hit, userId, cfg, durationSec, detailed, clipId: clip?.id }),
      files: [new AttachmentBuilder(mp3, { name: clipName(hit, createdAt) })],
      components: detailed ? clipButtons({ clipId: clip?.id, ownerId: userId, canTrim: Boolean(clip) }) : [],
      allowedMentions: NO_PINGS,
    });

    if (clip) {
      library.update(clip, { channelId: channel.id, messageId: message.id, messageUrl: message.url });
      const removed = library.enforceLimits(channel.guild.id, cfg);
      if (removed.length) log.info?.(`Removed ${removed.length} old clip(s) to stay within storage limits`);
    }
  };
}

// Handles the Trim and Delete buttons on detailed clip posts.
export function createClipActions({ library, store }) {
  const mayEdit = (interaction, ownerId) =>
    interaction.user.id === ownerId ||
    Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages));

  async function onButton(interaction, action, clipId, ownerId) {
    if (!mayEdit(interaction, ownerId)) {
      return interaction.reply(ephemeral('Only the person in the clip, or someone who can manage messages, can do that.'));
    }
    const clip = library && ClipLibrary.isValidId(clipId) ? library.get(interaction.guildId, clipId) : null;

    if (action === 'delete') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.message.delete().catch(() => {});
      if (clip) library.remove(clip);
      return interaction.editReply('🗑️ Clip deleted.');
    }

    if (action === 'trim') {
      if (!clip) return interaction.reply(ephemeral("That clip isn't saved any more, so it can't be trimmed."));
      const total = clip.durationSec.toFixed(1);
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`clip:trimmodal:${clip.id}:${ownerId}`)
          .setTitle('Trim clip')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('start').setLabel(`Start at (seconds, 0 to ${total})`).setStyle(TextInputStyle.Short).setValue('0').setMaxLength(6).setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('end').setLabel(`End at (seconds, up to ${total})`).setStyle(TextInputStyle.Short).setValue(total).setMaxLength(6).setRequired(true),
            ),
          ),
      );
    }
  }

  async function onTrimSubmit(interaction, clipId, ownerId) {
    if (!mayEdit(interaction, ownerId)) return interaction.reply(ephemeral("You can't trim this clip."));
    const clip = library && ClipLibrary.isValidId(clipId) ? library.get(interaction.guildId, clipId) : null;
    if (!clip) return interaction.reply(ephemeral("That clip isn't saved any more."));

    const start = Number(interaction.fields.getTextInputValue('start'));
    const end = Number(interaction.fields.getTextInputValue('end'));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > clip.durationSec + 0.05 || end - start < MIN_TRIM_SEC) {
      return interaction.reply(
        ephemeral(`Pick a start and end between 0 and ${clip.durationSec.toFixed(1)} seconds, at least ${MIN_TRIM_SEC}s apart.`),
      );
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const trimmed = await trimMp3(library.read(clip), start, Math.min(end, clip.durationSec));
    const durationSec = Math.min(end, clip.durationSec) - start;
    library.replaceAudio(clip, trimmed, durationSec);

    const cfg = store.get(interaction.guildId);
    const hit = clip.trigger ? { trigger: clip.trigger, transcript: clip.transcript } : null;
    await interaction.message.edit({
      content: clipCaption({ hit, userId: clip.userId, cfg, durationSec, detailed: true, clipId: clip.id, trimmed: true }),
      files: [new AttachmentBuilder(trimmed, { name: clipName(hit, clip.createdAt) })],
      attachments: [],
      allowedMentions: NO_PINGS,
    });
    return interaction.editReply(`✂️ Trimmed to ${durationSec.toFixed(1)}s.`);
  }

  return async function onClipInteraction(interaction) {
    const [prefix, action, clipId, ownerId] = interaction.customId.split(':');
    if (prefix !== 'clip' || !ownerId) return false;
    try {
      if (interaction.isButton()) await onButton(interaction, action, clipId, ownerId);
      else if (interaction.isModalSubmit() && action === 'trimmodal') await onTrimSubmit(interaction, clipId, ownerId);
    } catch (err) {
      console.error('Clip action failed:', err);
      const msg = ephemeral('Something went wrong with that clip.');
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
    return true;
  };
}
