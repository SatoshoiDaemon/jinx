import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { updateModuleConfig, updateModuleConfigValue } from '../../models/bot-config.js';
import { replyV2 } from '../common/components-v2.js';
import { showPanelHome, showTicketAdmin } from './admin-ui.js';
import {
  buildTicketOptionModal,
  buildTicketOptionSettingsModal,
  buildTicketPanelModal,
  buildTicketSettingsModal,
  normalizeTicketEmoji,
  ticketPanelConfirmationRows,
} from './components.js';
import {
  getTicketSettings,
  TICKET_PANEL_COLLECTION,
} from './repository.js';
import {
  publishTicketPanel,
  refreshPublishedTicketPanel,
} from './service.js';

const PANELS = TICKET_PANEL_COLLECTION;

function collectDiscordValidationErrors(value, path = '', output = []) {
  if (!value || typeof value !== 'object' || output.length >= 12) return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectDiscordValidationErrors(item, `${path}[${index}]`, output));
    return output;
  }
  for (const issue of value._errors ?? []) {
    output.push({
      path: path || '(request)',
      code: String(issue.code ?? 'UNKNOWN').slice(0, 80),
      message: String(issue.message ?? 'Invalid field').slice(0, 180),
    });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === '_errors') continue;
    collectDiscordValidationErrors(child, path ? `${path}.${key}` : key, output);
  }
  return output;
}

function logPanelPublishFailure(error, panel) {
  console.error('[Tickets] Falha ao publicar painel de atendimento.', {
    panelId: panel?._id ?? null,
    channelId: panel?.channelId ?? null,
    interactionType: panel?.interactionType ?? null,
    activeOptionCount: panel?.options?.filter((option) => option.active !== false).length ?? 0,
    error: {
      name: error?.name ?? 'Error',
      code: error?.code ?? null,
      status: error?.status ?? null,
      discordCode: error?.rawError?.code ?? null,
      discordMessage: String(error?.rawError?.message ?? error?.message ?? 'Unknown error').slice(0, 240),
      missingPermissions: error?.missingPermissions ?? [],
      validationErrors: JSON.stringify(collectDiscordValidationErrors(error?.rawError?.errors)),
    },
  });
}

function panelPublishErrorResponse(error) {
  if (error?.message === 'PANEL_CHANNEL_REQUIRED') {
    return 'Selecione o canal de publicação do painel primeiro.';
  }
  if (error?.message === 'PANEL_OPTION_LIMIT') {
    return 'O painel excede o limite de 25 opções.';
  }
  if (error?.message === 'PANEL_CHANNEL_INVALID') {
    return 'O canal de publicação não está disponível ou não aceita mensagens.';
  }
  if (error?.message === 'PANEL_OPTION_EMOJI_INVALID') {
    const options = error.invalidOptionNumbers?.length
      ? ` (opções ${error.invalidOptionNumbers.join(', ')})`
      : '';
    return `O Discord rejeitou o emoji de uma ou mais opções${options}. Troque ou remova os emojis e publique novamente.`;
  }
  if (error?.message === 'PANEL_BOT_PERMISSIONS') {
    const labels = {
      [PermissionFlagsBits.ViewChannel]: 'Ver canal',
      [PermissionFlagsBits.SendMessages]: 'Enviar mensagens',
      [PermissionFlagsBits.EmbedLinks]: 'Incorporar links',
      [PermissionFlagsBits.UseExternalEmojis]: 'Usar emojis externos',
    };
    return `Faltam permissões no canal de publicação: ${(error.missingPermissions ?? []).map((permission) => labels[permission] ?? 'permissão necessária').join(', ')}.`;
  }
  if (error?.message === 'PANEL_BUSY') {
    return 'Este painel já está sendo publicado. Tente novamente em alguns segundos.';
  }

  return 'Não foi possível publicar o painel. Confira a configuração e tente novamente.';
}

function hasManageServer(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function panelOptionsPage(panelId, optionId = undefined, page = 0) {
  return { page: 'options', panelId, optionId, panelPage: page };
}

function panelListPage(panelId, page = 0) {
  return { page: 'panels', panelId, panelPage: page };
}

function parseImages(raw) {
  const lines = raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 10) throw new Error('PANEL_IMAGES_INVALID');
  const unique = [...new Set(lines)];
  for (const value of unique) {
    if (value.length > 2048) throw new Error('PANEL_IMAGES_INVALID');
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('PANEL_IMAGES_INVALID');
    }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      throw new Error('PANEL_IMAGES_INVALID');
    }
  }
  return unique;
}

function validatePanelText({ name, title, description, message, imageUrls }) {
  if (!name || name.length > 80 || !title || title.length > 180) throw new Error('PANEL_TEXT_INVALID');
  if (description.length > 1200 || message.length > 1400) throw new Error('PANEL_TEXT_INVALID');
  const combined = [`# ${title}`, description, message].filter(Boolean).join('\n\n');
  if (combined.length > 3900 || imageUrls.length > 10) throw new Error('PANEL_TEXT_INVALID');
}

function validateEmoji(emoji, label) {
  const normalized = normalizeTicketEmoji(emoji);
  if (normalized === null) throw new Error('OPTION_EMOJI_INVALID');
  if (!normalized) return '';
  try {
    new ButtonBuilder()
      .setCustomId('ticket:emoji-check')
      .setLabel(label.slice(0, 80) || 'Opção')
      .setStyle(ButtonStyle.Primary)
      .setEmoji(normalized)
      .toJSON();
  } catch {
    throw new Error('OPTION_EMOJI_INVALID');
  }
  return normalized;
}

function panelFromModal(interaction) {
  const name = interaction.fields.getTextInputValue('name').trim();
  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim();
  const message = interaction.fields.getTextInputValue('message').trim();
  const imageUrls = parseImages(interaction.fields.getTextInputValue('images'));
  validatePanelText({ name, title, description, message, imageUrls });
  return {
    name,
    title,
    description,
    message,
    imageUrls,
    updatedAt: new Date(),
  };
}

async function updatePanelDocument(database, panel, changes) {
  const revision = panel.revision ?? 0;
  const result = await database.collection(PANELS).updateOne(
    { _id: panel._id, revision },
    { $set: { ...changes, updatedAt: new Date() }, $inc: { revision: 1 } },
  );
  if (result.modifiedCount !== 1) throw new Error('PANEL_EDIT_CONFLICT');
  return database.collection(PANELS).findOne({ _id: panel._id });
}

async function refreshIfPublished(panel, context) {
  if (!panel?.messageId) return false;
  try {
    return await refreshPublishedTicketPanel(panel._id, context);
  } catch (error) {
    console.error(`[Tickets] Falha ao atualizar painel publicado (${error?.name ?? 'Erro'}).`);
    return false;
  }
}

async function showAdmin(interaction, context, options = {}) {
  await showTicketAdmin(interaction, context, options);
}

async function saveDefaultChannel(interaction, context, path, channelType) {
  const channelId = interaction.values[0];
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channelType.includes(channel.type)) {
    await replyV2(interaction, 'O canal selecionado não está mais disponível ou é incompatível.', { ephemeral: true });
    return true;
  }
  const current = await getTicketSettings(context.database);
  if ((path === 'logsChannelId' && current.transcriptsChannelId === channel.id)
    || (path === 'transcriptsChannelId' && current.logsChannelId === channel.id)) {
    await replyV2(interaction, 'Logs operacionais e transcripts precisam usar canais diferentes.', { ephemeral: true });
    return true;
  }
  await interaction.deferUpdate();
  await updateModuleConfigValue(context.database, 'tickets', path, channel.id);
  await showAdmin(interaction, context, { page: 'settings', subpage: 'channels', alreadyDeferred: true });
  return true;
}

async function saveOptionRoleSelection(interaction, context, panelId, optionId) {
  const panel = await context.database.collection(PANELS).findOne({ _id: panelId });
  const option = panel?.options?.find((item) => item.id === optionId);
  if (!panel || !option || option.action !== 'ticket') {
    await replyV2(interaction, 'A opção selecionada não está mais disponível.', { ephemeral: true });
    return true;
  }
  const roleIds = [...new Set(interaction.values)];
  if (roleIds.some((id) => id === interaction.guildId || !interaction.guild.roles.cache.has(id))) {
    await replyV2(interaction, 'Selecione cargos válidos diferentes de @everyone.', { ephemeral: true });
    return true;
  }
  await interaction.deferUpdate();
  const options = panel.options.map((item) => item.id === optionId ? { ...item, staffRoleIds: roleIds } : item);
  const updated = await updatePanelDocument(context.database, panel, { options });
  await refreshIfPublished(updated, context);
  await showAdmin(interaction, context, { ...panelOptionsPage(panelId, optionId), alreadyDeferred: true });
  return true;
}

async function handlePanelModal(interaction, context) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith('ptm:')) return false;
  if (!hasManageServer(interaction)) {
    await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor** para configurar tickets.', { ephemeral: true });
    return true;
  }
  await interaction.deferReply({ ephemeral: true });

  const modalReply = async (content) => interaction.editReply({
    content,
    allowedMentions: { parse: [] },
  });

  if (interaction.customId === 'ptm:panel:new' || /^ptm:panel:[^:]+$/.test(interaction.customId)) {
    const existingId = interaction.customId === 'ptm:panel:new'
      ? null
      : interaction.customId.slice('ptm:panel:'.length);
    try {
      if (!existingId) {
        const panel = panelFromModal(interaction);
        const created = {
          _id: randomUUID(),
          ...panel,
          interactionType: 'buttons',
          options: [],
          channelId: null,
          messageId: null,
          active: false,
          revision: 0,
          createdAt: new Date(),
        };
        await context.database.collection(PANELS).insertOne(created);
        await modalReply('Painel criado como rascunho. Selecione o canal, configure as opções e publique.');
        return true;
      }
      const previous = await context.database.collection(PANELS).findOne({ _id: existingId });
      if (!previous) throw new Error('PANEL_NOT_FOUND');
      const updated = await updatePanelDocument(context.database, previous, panelFromModal(interaction));
      await refreshIfPublished(updated, context);
      await modalReply('Painel atualizado. Se já estava publicado, a mensagem foi sincronizada.');
    } catch (error) {
      const message = error.message === 'PANEL_IMAGES_INVALID'
        ? 'Use até 10 URLs HTTPS válidas, uma por linha.'
        : error.message === 'PANEL_TEXT_INVALID'
          ? 'Confira os limites do nome, título, descrição e mensagem do painel.'
            : error.message === 'PANEL_EDIT_CONFLICT'
              ? 'Este painel foi alterado por outra ação. Abra-o novamente e repita a edição.'
              : 'Não foi possível salvar o painel. Abra o `/painel` novamente e tente outra vez.';
      await modalReply(message);
    }
    return true;
  }

  const optionMatch = /^ptm:option:([^:]+):([^:]+)$/.exec(interaction.customId);
  if (optionMatch) {
    const [, panelId, optionId] = optionMatch;
    const panel = await context.database.collection(PANELS).findOne({ _id: panelId });
    if (!panel) {
      await modalReply('O painel selecionado não está mais disponível.');
      return true;
    }
    try {
      const label = interaction.fields.getTextInputValue('label').trim();
      const description = interaction.fields.getTextInputValue('description').trim();
      const rawEmoji = interaction.fields.getTextInputValue('emoji').trim();
      const action = interaction.fields.getTextInputValue('action').trim().toLowerCase();
      const responseText = interaction.fields.getTextInputValue('response').trim();
      if (!label || label.length > 80 || description.length > 100 || !['ticket', 'reply'].includes(action)) {
        throw new Error('OPTION_INVALID');
      }
      if (action === 'reply' && !responseText) throw new Error('OPTION_REPLY_REQUIRED');
      if (responseText.length > 1800) throw new Error('OPTION_INVALID');
      const emoji = validateEmoji(rawEmoji, label);
      let options;
      if (optionId === 'new') {
        if (panel.options.length >= 25) throw new Error('OPTION_LIMIT');
        options = [...panel.options, {
          id: randomUUID(),
          label,
          description,
          emoji,
          action,
          responseText,
          active: true,
          threadChannelId: null,
          staffRoleIds: [],
          prefix: 'ticket',
          initialMessage: '',
          maxTicketsPerMember: null,
          createdAt: new Date(),
        }];
      } else {
        const existing = panel.options.find((item) => item.id === optionId);
        if (!existing) throw new Error('OPTION_NOT_FOUND');
        options = panel.options.map((item) => item.id === optionId
          ? { ...item, label, description, emoji, action, responseText }
          : item);
      }
      const updated = await updatePanelDocument(context.database, panel, { options });
      await refreshIfPublished(updated, context);
      await modalReply('Opção salva e painel publicado sincronizado quando disponível.');
      return true;
    } catch (error) {
      const message = error.message === 'OPTION_LIMIT'
        ? 'Cada painel pode ter até 25 opções devido aos limites de componentes do Discord.'
        : error.message === 'OPTION_REPLY_REQUIRED'
          ? 'Informe a resposta privada para ações do tipo `reply`.'
          : error.message === 'OPTION_EMOJI_INVALID'
            ? 'Use um único emoji Unicode válido ou um emoji personalizado do servidor.'
            : 'Confira o rótulo, descrição e a ação (`ticket` ou `reply`) da opção.';
      await modalReply(message);
      return true;
    }
  }

  const configMatch = /^ptm:config:([^:]+):([^:]+)$/.exec(interaction.customId);
  if (configMatch) {
    const [, panelId, optionId] = configMatch;
    const panel = await context.database.collection(PANELS).findOne({ _id: panelId });
    const option = panel?.options?.find((item) => item.id === optionId);
    if (!panel || !option || option.action !== 'ticket') {
      await modalReply('Esta opção não está configurada para abrir tickets.');
      return true;
    }
    const prefix = interaction.fields.getTextInputValue('prefix').trim();
    const initialMessage = interaction.fields.getTextInputValue('initialMessage').trim();
    const limitText = interaction.fields.getTextInputValue('ticketLimit').trim();
    const limit = limitText ? Number(limitText) : null;
    if (!/^[\p{L}\p{N}_-]{1,35}$/u.test(prefix)
      || initialMessage.length > 1800
      || (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 10))) {
      await modalReply('Prefixo inválido. O limite deve ser um inteiro de 1 a 10 ou ficar vazio para usar o padrão.');
      return true;
    }
    const options = panel.options.map((item) => item.id === optionId
      ? { ...item, prefix, initialMessage, maxTicketsPerMember: limit }
      : item);
    const updated = await updatePanelDocument(context.database, panel, { options });
    await refreshIfPublished(updated, context);
    await modalReply('Configuração específica do ticket salva.');
    return true;
  }

  if (interaction.customId === 'ptm:settings') {
    const current = await getTicketSettings(context.database);
    const maxTickets = Number(interaction.fields.getTextInputValue('maxTickets').trim());
    const requesterReopen = interaction.fields.getTextInputValue('requesterReopen').trim().toLowerCase();
    const resolvedBehavior = interaction.fields.getTextInputValue('resolvedBehavior').trim().toLowerCase();
    const initialMessage = interaction.fields.getTextInputValue('initialMessage').trim();
    if (!Number.isSafeInteger(maxTickets) || maxTickets < 1 || maxTickets > 10
      || !['sim', 'nao', 'não'].includes(requesterReopen)
      || !['archive', 'delete', 'arquivar', 'excluir'].includes(resolvedBehavior)
      || initialMessage.length > 1800) {
      await modalReply('Use limite de 1 a 10, `sim` ou `nao`, e `arquivar` ou `excluir`.');
      return true;
    }
    const normalizedBehavior = ['delete', 'excluir'].includes(resolvedBehavior) ? 'delete' : 'archive';
    const settings = {
      maxTicketsPerMember: maxTickets,
      requesterCanReopen: ['sim'].includes(requesterReopen),
      resolvedThreadBehavior: normalizedBehavior,
      defaultInitialMessage: initialMessage,
    };
    await updateModuleConfig(context.database, 'tickets', { ...current, ...settings });
    await modalReply('Regras padrão dos tickets atualizadas.');
    return true;
  }
  return false;
}

export async function handleTicketAdminInteraction(interaction, context) {
  const customId = interaction.customId ?? '';
  if (!customId.startsWith('panel:tickets:') && !customId.startsWith('pt:o:') && !customId.startsWith('ptm:')) {
    return false;
  }
  context = { ...context, guild: interaction.guild };
  if (!hasManageServer(interaction)) {
    await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor** para configurar tickets.', { ephemeral: true });
    return true;
  }
  if (interaction.isModalSubmit()) return handlePanelModal(interaction, context);

  if (interaction.isButton() && customId === 'panel:tickets:home') {
    await interaction.deferUpdate();
    await showPanelHome(interaction);
    return true;
  }
  if (interaction.isButton() && customId === 'panel:tickets:toggle') {
    await interaction.deferUpdate();
    const settings = await getTicketSettings(context.database);
    await updateModuleConfigValue(context.database, 'tickets', 'enabled', !settings.enabled);
    const panels = await context.database.collection(PANELS).find({ messageId: { $type: 'string' } }).toArray();
    for (const panel of panels) await refreshIfPublished(panel, context);
    await showAdmin(interaction, context, { page: 'overview', alreadyDeferred: true });
    return true;
  }

  if (interaction.isButton() && customId.startsWith('panel:tickets:settings:')) {
    if (customId === 'panel:tickets:settings:edit') {
      const settings = await getTicketSettings(context.database);
      await interaction.showModal(buildTicketSettingsModal(settings));
      return true;
    }
    const page = customId.endsWith(':staff') ? 'staff' : 'channels';
    await showAdmin(interaction, context, { page: 'settings', subpage: page });
    return true;
  }

  if (interaction.isButton() && customId.startsWith('panel:tickets:panels:')) {
    const confirmDelete = /^panel:tickets:panels:confirm-delete:([^:]+)$/.exec(customId);
    if (confirmDelete) {
      await interaction.deferUpdate();
      const panel = await context.database.collection(PANELS).findOne({ _id: confirmDelete[1] });
      if (!panel) {
        await showAdmin(interaction, context, { page: 'panels', panelPage: 0, alreadyDeferred: true });
        return true;
      }
      if (panel.messageId && panel.channelId) {
        const channel = await context.guild.channels.fetch(panel.channelId).catch(() => null);
        await channel?.messages.delete(panel.messageId).catch(() => {});
      }
      await context.database.collection(PANELS).deleteOne({ _id: panel._id });
      await showAdmin(interaction, context, { page: 'panels', panelPage: 0, alreadyDeferred: true });
      return true;
    }
    if (/^panel:tickets:panels:cancel-delete:[^:]+$/.test(customId)) {
      await replyV2(interaction, 'Exclusão cancelada.', { ephemeral: true });
      return true;
    }
    const publish = /^panel:tickets:panels:publish:([^:]+)$/.exec(customId);
    if (publish) {
      await interaction.deferReply({ ephemeral: true });
      try {
        const message = await publishTicketPanel(publish[1], { ...context, guild: interaction.guild });
        await interaction.editReply({ content: `Painel publicado ou atualizado: ${message.url}` });
      } catch (error) {
        const panel = await context.database.collection(PANELS).findOne({ _id: publish[1] }).catch(() => null);
        logPanelPublishFailure(error, panel);
        await interaction.editReply({ content: panelPublishErrorResponse(error) });
      }
      return true;
    }
    const toggle = /^panel:tickets:panels:toggle:([^:]+)$/.exec(customId);
    if (toggle) {
      const panel = await context.database.collection(PANELS).findOne({ _id: toggle[1] });
      if (!panel) {
        await replyV2(interaction, 'Este painel não está mais disponível.', { ephemeral: true });
        return true;
      }
      if (!panel.active && !panel.messageId) {
        await replyV2(interaction, 'Publique o painel antes de ativá-lo.', { ephemeral: true });
        return true;
      }
      if (!panel.active && !panel.options.some((option) => option.active !== false)) {
        await replyV2(interaction, 'Ative ao menos uma opção antes de ativar o painel.', { ephemeral: true });
        return true;
      }
      await interaction.deferUpdate();
      await updatePanelDocument(context.database, panel, { active: !panel.active });
      const updated = await context.database.collection(PANELS).findOne({ _id: panel._id });
      await refreshIfPublished(updated, context);
      await showAdmin(interaction, context, { ...panelListPage(panel._id), alreadyDeferred: true });
      return true;
    }
    const interactionType = /^panel:tickets:panels:interaction:([^:]+)$/.exec(customId);
    if (interactionType) {
      const panel = await context.database.collection(PANELS).findOne({ _id: interactionType[1] });
      if (!panel) {
        await replyV2(interaction, 'Este painel não está mais disponível.', { ephemeral: true });
        return true;
      }
      await interaction.deferUpdate();
      const updated = await updatePanelDocument(context.database, panel, {
        interactionType: panel.interactionType === 'select' ? 'buttons' : 'select',
      });
      await refreshIfPublished(updated, context);
      await showAdmin(interaction, context, { ...panelListPage(updated._id), alreadyDeferred: true });
      return true;
    }
    const edit = /^panel:tickets:panels:edit:([^:]+)$/.exec(customId);
    if (edit) {
      const panel = await context.database.collection(PANELS).findOne({ _id: edit[1] });
      if (!panel) {
        await replyV2(interaction, 'Este painel não está mais disponível.', { ephemeral: true });
        return true;
      }
      await interaction.showModal(buildTicketPanelModal(panel));
      return true;
    }
    const remove = /^panel:tickets:panels:delete:([^:]+)$/.exec(customId);
    if (remove) {
      const panel = await context.database.collection(PANELS).findOne({ _id: remove[1] });
      if (!panel) {
        await replyV2(interaction, 'Este painel não está mais disponível.', { ephemeral: true });
        return true;
      }
      await replyV2(interaction, `Excluir **${panel.name}** e remover sua mensagem publicada? Esta ação não pode ser desfeita.`, {
        ephemeral: true,
        rows: ticketPanelConfirmationRows(panel._id),
      });
      return true;
    }
    const create = /^panel:tickets:panels:new:(\d+)$/.exec(customId);
    if (create) {
      await interaction.showModal(buildTicketPanelModal());
      return true;
    }
  }

  const optionsPage = /^panel:tickets:options:([^:]+)$/.exec(customId);
  if (interaction.isButton() && optionsPage) {
    await showAdmin(interaction, context, panelOptionsPage(optionsPage[1]));
    return true;
  }

  const panelPageButton = /^panel:tickets:panels:(\d+)(?::([^:]+))?$/.exec(customId);
  if (interaction.isButton() && panelPageButton) {
    const page = Number(panelPageButton[1]);
    const selectedId = panelPageButton[2] === '-' ? undefined : panelPageButton[2];
    await showAdmin(interaction, context, panelListPage(selectedId, page));
    return true;
  }
  const panelSelector = /^panel:tickets:panels:select:(\d+)$/.exec(customId);
  if (interaction.isStringSelectMenu() && panelSelector) {
    const page = Number(panelSelector[1]);
    await showAdmin(interaction, context, panelListPage(interaction.values[0], page));
    return true;
  }

  if (interaction.isButton() && customId.startsWith('panel:tickets:panels:new:')) {
    await interaction.showModal(buildTicketPanelModal());
    return true;
  }

  if (interaction.isChannelSelectMenu() && customId === 'panel:tickets:default:thread') {
    return saveDefaultChannel(interaction, context, 'defaultThreadChannelId', [ChannelType.GuildText]);
  }
  if (interaction.isChannelSelectMenu() && customId === 'panel:tickets:default:logs') {
    return saveDefaultChannel(interaction, context, 'logsChannelId', [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  }
  if (interaction.isChannelSelectMenu() && customId === 'panel:tickets:default:transcripts') {
    return saveDefaultChannel(interaction, context, 'transcriptsChannelId', [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  }
  if (interaction.isButton() && /^panel:tickets:default:clear-(thread|logs|transcripts)$/.test(customId)) {
    const [, target] = /^panel:tickets:default:clear-(thread|logs|transcripts)$/.exec(customId);
    const paths = { thread: 'defaultThreadChannelId', logs: 'logsChannelId', transcripts: 'transcriptsChannelId' };
    await interaction.deferUpdate();
    await updateModuleConfigValue(context.database, 'tickets', paths[target], null);
    await showAdmin(interaction, context, { page: 'settings', subpage: 'channels', alreadyDeferred: true });
    return true;
  }
  if (interaction.isRoleSelectMenu() && customId === 'panel:tickets:default:staff') {
    const roleIds = [...new Set(interaction.values)];
    if (roleIds.some((id) => id === interaction.guildId || !interaction.guild.roles.cache.has(id))) {
      await replyV2(interaction, 'Selecione cargos válidos diferentes de @everyone.', { ephemeral: true });
      return true;
    }
    await interaction.deferUpdate();
    await updateModuleConfigValue(context.database, 'tickets', 'staffRoleIds', roleIds);
    await showAdmin(interaction, context, { page: 'settings', subpage: 'staff', alreadyDeferred: true });
    return true;
  }

  const panelChannel = /^panel:tickets:panel-channel:([^:]+)$/.exec(customId);
  if (interaction.isChannelSelectMenu() && panelChannel) {
    const panel = await context.database.collection(PANELS).findOne({ _id: panelChannel[1] });
    const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
    if (!panel || !channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      await replyV2(interaction, 'Painel ou canal não está mais disponível.', { ephemeral: true });
      return true;
    }
    await interaction.deferUpdate();
    if (panel.channelId && panel.channelId !== channel.id && panel.messageId) {
      const oldChannel = await interaction.guild.channels.fetch(panel.channelId).catch(() => null);
      await oldChannel?.messages.delete(panel.messageId).catch(() => {});
    }
    const updated = await updatePanelDocument(context.database, panel, {
      channelId: channel.id,
      ...(panel.channelId !== channel.id ? { messageId: null, active: false } : {}),
    });
    await showAdmin(interaction, context, { ...panelListPage(updated._id), alreadyDeferred: true });
    return true;
  }

  const optionChannel = /^pt:o:channel:([^:]+):([^:]+)$/.exec(customId);
  if (interaction.isChannelSelectMenu() && optionChannel) {
    const [, panelId, optionId] = optionChannel;
    const panel = await context.database.collection(PANELS).findOne({ _id: panelId });
    const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
    const option = panel?.options?.find((item) => item.id === optionId);
    if (!panel || !option || option.action !== 'ticket' || channel?.type !== ChannelType.GuildText) {
      await replyV2(interaction, 'Opção ou canal incompatível.', { ephemeral: true });
      return true;
    }
    await interaction.deferUpdate();
    const options = panel.options.map((item) => item.id === optionId ? { ...item, threadChannelId: channel.id } : item);
    const updated = await updatePanelDocument(context.database, panel, { options });
    await refreshIfPublished(updated, context);
    await showAdmin(interaction, context, { ...panelOptionsPage(panelId, optionId), alreadyDeferred: true });
    return true;
  }

  const optionRoles = /^pt:o:roles:([^:]+):([^:]+)$/.exec(customId);
  if (interaction.isRoleSelectMenu() && optionRoles) {
    return saveOptionRoleSelection(interaction, context, optionRoles[1], optionRoles[2]);
  }

  const defaultOptionChannel = /^pt:o:default:([^:]+):([^:]+)$/.exec(customId);
  if (interaction.isButton() && defaultOptionChannel) {
    const [, panelId, optionId] = defaultOptionChannel;
    const panel = await context.database.collection(PANELS).findOne({ _id: panelId });
    if (!panel) {
      await replyV2(interaction, 'Painel indisponível.', { ephemeral: true });
      return true;
    }
    await interaction.deferUpdate();
    const options = panel.options.map((item) => item.id === optionId
      ? { ...item, threadChannelId: null }
      : item);
    const updated = await updatePanelDocument(context.database, panel, { options });
    await refreshIfPublished(updated, context);
    await showAdmin(interaction, context, { ...panelOptionsPage(panelId, optionId), alreadyDeferred: true });
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    const optionSelector = /^panel:tickets:options:select:([^:]+)$/.exec(customId);
    if (optionSelector) {
      await showAdmin(interaction, context, panelOptionsPage(optionSelector[1], interaction.values[0]));
      return true;
    }
  }

  const newOption = /^panel:tickets:options:new:([^:]+)$/.exec(customId);
  if (interaction.isButton() && newOption) {
    const panel = await context.database.collection(PANELS).findOne({ _id: newOption[1] });
    if (!panel) {
      await replyV2(interaction, 'Painel indisponível.', { ephemeral: true });
      return true;
    }
    if (panel.options.length >= 25) {
      await replyV2(interaction, 'Cada painel pode ter no máximo 25 opções.', { ephemeral: true });
      return true;
    }
    await interaction.showModal(buildTicketOptionModal(panel._id));
    return true;
  }

  const optionAction = /^pt:o:(edit|settings|toggle|delete):([^:]+):([^:]+)$/.exec(customId);
  if (interaction.isButton() && optionAction) {
    const [, action, panelId, optionId] = optionAction;
    const panel = await context.database.collection(PANELS).findOne({ _id: panelId });
    const option = panel?.options?.find((item) => item.id === optionId);
    if (!panel || !option) {
      await replyV2(interaction, 'Opção indisponível.', { ephemeral: true });
      return true;
    }
    if (action === 'edit') {
      await interaction.showModal(buildTicketOptionModal(panelId, option));
      return true;
    }
    if (action === 'settings') {
      await interaction.showModal(buildTicketOptionSettingsModal(panelId, option));
      return true;
    }
    if (action === 'toggle') {
      const options = panel.options.map((item) => item.id === optionId ? { ...item, active: item.active === false } : item);
      await interaction.deferUpdate();
      const updated = await updatePanelDocument(context.database, panel, {
        options,
        active: panel.active && options.some((item) => item.active !== false),
      });
      await refreshIfPublished(updated, context);
      await showAdmin(interaction, context, { ...panelOptionsPage(panelId, optionId), alreadyDeferred: true });
      return true;
    }
    if (action === 'delete') {
      const options = panel.options.filter((item) => item.id !== optionId);
      await interaction.deferUpdate();
      const updated = await updatePanelDocument(context.database, panel, {
        options,
        active: panel.active && options.some((item) => item.active !== false),
      });
      await refreshIfPublished(updated, context);
      await showAdmin(interaction, context, { ...panelOptionsPage(panelId), alreadyDeferred: true });
      return true;
    }
  }

  return false;
}
