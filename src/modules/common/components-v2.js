import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';

const ALLOWED_MENTIONS = Object.freeze({ parse: [] });

export function createV2Container(content, { rows = [], media = [] } = {}) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  if (media.length) {
    container.addMediaGalleryComponents(...media);
  }
  if (rows.length) {
    container.addActionRowComponents(...rows);
  }

  return container;
}

export function v2ReplyPayload(content, options = {}) {
  const flags = MessageFlags.IsComponentsV2
    | (options.ephemeral ? MessageFlags.Ephemeral : 0);

  return {
    components: [createV2Container(content, options)],
    flags,
    allowedMentions: ALLOWED_MENTIONS,
  };
}

export function v2EditPayload(content, options = {}) {
  const { flags, ...payload } = v2ReplyPayload(content, options);
  return payload;
}

export async function replyV2(interaction, content, options = {}) {
  const payload = v2ReplyPayload(content, options);
  if (interaction.deferred) {
    const { flags, ...editPayload } = payload;
    return interaction.editReply(editPayload);
  }
  if (interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

export async function editReplyV2(interaction, content, options = {}) {
  return interaction.editReply(v2EditPayload(content, options));
}
