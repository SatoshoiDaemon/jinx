import { createHash, randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  parseEmoji,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { replyV2 } from '../common/components-v2.js';
import {
  TICKET_COLLECTION,
  TICKET_EVENT_COLLECTION,
  TICKET_PANEL_COLLECTION,
  TICKET_REQUEST_COLLECTION,
  allocateTicketNumber,
  getMemberActiveTicketCount,
  getTicketSettings,
  reconcileMemberTicketSlots,
  releaseMemberTicketSlot,
  reserveMemberTicketSlot,
} from './repository.js';
import {
  buildPublishedPanelPayload,
  buildTicketControlEmbed,
  buildTicketControlRows,
  ticketControlMessagePayload,
  ticketResolveConfirmationRows,
  ticketUserSelectRow,
  normalizeTicketEmoji,
} from './components.js';
import { createTranscriptHtml, fetchAllThreadMessages } from './transcript.js';

const PANEL_COLLECTION = TICKET_PANEL_COLLECTION;
const TICKETS = TICKET_COLLECTION;
const REQUESTS = TICKET_REQUEST_COLLECTION;
const EVENTS = TICKET_EVENT_COLLECTION;
const ALLOWED_MENTIONS = Object.freeze({ parse: [] });
const LOCK_DURATION_MS = 2 * 60 * 1000;
const MAX_PRIVATE_THREAD_MEMBERS = 950;

class TicketFlowError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TicketFlowError';
    this.code = code;
  }
}

const USER_MESSAGES = Object.freeze({
  TICKET_SYSTEM_DISABLED: 'O sistema de tickets está desativado no momento.',
  PANEL_INACTIVE: 'Este painel de atendimento está desativado.',
  OPTION_INACTIVE: 'Esta opção de atendimento não está mais disponível.',
  TICKET_LIMIT_REACHED: 'Você já atingiu o limite de tickets simultâneos para esta categoria.',
  REQUEST_EXPIRED: 'Este formulário expirou. Selecione a opção no painel novamente.',
  REQUEST_USED: 'Este formulário já foi enviado ou expirou. Selecione a opção no painel novamente.',
  THREAD_CHANNEL_INVALID: 'O canal de tópicos não está configurado ou não está mais disponível.',
  BOT_THREAD_PERMISSIONS: 'O bot precisa de Ver canal, Criar tópicos privados, Enviar mensagens em tópicos, Gerenciar tópicos, Ler histórico, Incorporar links e Gerenciar mensagens no canal de tópicos.',
  REQUESTER_THREAD_PERMISSIONS: 'Você precisa ter acesso ao canal que hospeda os tópicos para abrir este ticket. Avise a equipe do servidor.',
  STAFF_ROLE_INVALID: 'Um cargo de atendimento configurado não existe mais. Peça à administração para atualizar o painel.',
  STAFF_THREAD_PERMISSIONS: 'Os membros de um cargo de atendimento precisam de acesso ao canal de tópicos e permissão para enviar mensagens em tópicos.',
  STAFF_TOO_LARGE: 'Há membros demais nos cargos de atendimento para adicionar a este tópico privado. Ajuste os cargos ou as permissões do canal.',
  INVALID_REASON: 'Informe um motivo com pelo menos 5 caracteres.',
  THREAD_CREATE_FAILED: 'Não foi possível criar o tópico privado. Confira as permissões do bot e tente novamente.',
  TICKET_NOT_FOUND: 'Este ticket não está mais disponível.',
  TICKET_WRONG_CHANNEL: 'Esta ação só pode ser usada no tópico do ticket.',
  TICKET_CONTROL_STALE: 'Este painel de controle foi substituído. Use a mensagem de controle atual dentro do ticket.',
  TICKET_ENDED: 'Este ticket já foi encerrado definitivamente.',
  TICKET_FINALIZING: 'A resolução deste ticket já está em andamento.',
  TICKET_ACTION_BUSY: 'Outra ação está sendo processada neste ticket. Tente novamente em instantes.',
  TICKET_NOT_OPEN: 'Esta ação só está disponível em tickets abertos.',
  TICKET_NOT_CLOSED: 'Este ticket não está fechado.',
  STAFF_ONLY: 'Esta ação está disponível apenas para a equipe de atendimento.',
  REQUESTER_ONLY: 'Esta ação está disponível apenas para o solicitante ou para a equipe.',
  ASSIGNEE_EXISTS: 'Este ticket já está atribuído a outra pessoa. Use **Transferir atendente** para mudar a responsabilidade.',
  ASSIGNEE_REQUIRED: 'Assuma o atendimento antes de transferir a responsabilidade.',
  ASSIGNEE_CANNOT_REMOVE: 'Libere ou transfira a responsabilidade antes de remover o atendente.',
  INVALID_MEMBER: 'Selecione membros válidos do servidor. Bots e o solicitante não podem ser adicionados como participantes.',
  PARTICIPANT_NOT_FOUND: 'Só é possível remover membros adicionais registrados neste ticket.',
  RESOLVER_CHANNEL_MISSING: 'O canal de transcripts não está configurado ou não está disponível.',
  TRANSCRIPT_TOO_LARGE: 'O transcript excede o limite de upload do Discord. O ticket continua recuperável; aumente o limite de upload do servidor ou reduza o histórico textual disponível antes de tentar novamente.',
  THREAD_MISSING: 'O tópico deste ticket foi excluído ou não está mais acessível.',
  TICKET_PARTIAL_ADD: 'Alguns membros foram adicionados, mas outros não puderam receber acesso ao tópico. Confira a mensagem de controle e tente novamente para os restantes.',
  TICKET_PARTIAL_REMOVE: 'Alguns participantes foram removidos, mas outros não puderam ser removidos do tópico. Confira o painel e tente novamente.',
});

function eventNonce(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 25);
}

function isUnknownMessage(error) {
  return Number(error?.code) === 10008;
}

function isTextChannel(channel) {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

function isPrivateThread(channel) {
  return channel?.isThread?.() === true;
}

function textInput(customId, label, placeholder, maxLength) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(placeholder)
      .setMinLength(5)
      .setMaxLength(maxLength)
      .setRequired(true),
  );
}

function settingsAreValid(settings) {
  return Number.isSafeInteger(settings.maxTicketsPerMember)
    && settings.maxTicketsPerMember >= 1
    && settings.maxTicketsPerMember <= 10
    && typeof settings.requesterCanReopen === 'boolean'
    && ['archive', 'delete'].includes(settings.resolvedThreadBehavior)
    && Array.isArray(settings.staffRoleIds)
    && typeof settings.defaultInitialMessage === 'string'
    && settings.defaultInitialMessage.length <= 1800;
}

function optionLimit(option, settings) {
  return option.maxTicketsPerMember ?? settings.maxTicketsPerMember;
}

function teamRoleIds(option, settings) {
  return option.staffRoleIds?.length ? option.staffRoleIds : settings.staffRoleIds;
}

function safeThreadName(prefix, displayName, ticketId) {
  const clean = `${prefix}-${displayName}`
    .replace(/[\r\n@#`<>:]/gu, '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 84);
  return `${clean || 'ticket'}-${String(ticketId).padStart(4, '0')}`.slice(0, 100);
}

function threadAutoArchiveDuration(guild) {
  if (guild.premiumTier >= 3) return 10080;
  if (guild.premiumTier >= 2) return 4320;
  return 1440;
}

function getRoleIdsFromMember(member) {
  return member?.roles?.cache ? [...member.roles.cache.keys()] : [];
}

function hasRole(member, roleIds) {
  return roleIds.some((roleId) => member?.roles?.cache?.has(roleId));
}

function isStaff(member, ticket) {
  return Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)
    || hasRole(member, ticket.staffRoleIds ?? []));
}

function actorName(member) {
  return member?.displayName ?? member?.user?.tag ?? member?.user?.username ?? 'Membro';
}

function ticketLink(guildId, threadId) {
  return threadId ? `https://discord.com/channels/${guildId}/${threadId}` : null;
}

function eventLabel(type) {
  return ({
    opened: 'Ticket aberto',
    assigned: 'Atendimento assumido',
    transferred: 'Responsabilidade transferida',
    released: 'Responsabilidade liberada',
    member_added: 'Membro adicionado',
    member_removed: 'Membro removido',
    member_add_failed: 'Falha ao conceder acesso ao membro',
    closed: 'Ticket fechado',
    reopened: 'Ticket reaberto',
    resolved: 'Ticket marcado como resolvido',
    ended: 'Ticket encerrado',
    finalization_failed: 'Falha ao finalizar ticket',
    thread_deleted: 'Tópico do ticket excluído',
  })[type] ?? type;
}

function errorMessage(error) {
  if (error instanceof TicketFlowError || error?.code in USER_MESSAGES) {
    return USER_MESSAGES[error.code] ?? 'Não foi possível concluir esta ação.';
  }
  return 'Não foi possível concluir esta ação. Tente novamente em instantes.';
}

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  try {
    return await guild.channels.fetch(channelId);
  } catch {
    return null;
  }
}

function assertHostBotPermissions(channel, botMember) {
  const permissions = channel.permissionsFor(botMember);
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.ManageThreads,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ManageMessages,
  ];
  if (!permissions?.has(required)) {
    throw new TicketFlowError('BOT_THREAD_PERMISSIONS');
  }
}

async function assertPanelBotPermissions(channel, guild, panel) {
  const botMember = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
  if (panel.imageUrls?.length) required.push(PermissionFlagsBits.EmbedLinks);
  const hasExternalEmoji = panel.options?.some((option) => {
    const emoji = parseEmoji(option.emoji ?? '');
    return Boolean(emoji?.id && !guild.emojis.cache.has(emoji.id));
  });
  if (hasExternalEmoji) required.push(PermissionFlagsBits.UseExternalEmojis);
  const missing = required.filter((permission) => !permissions?.has(permission));
  if (missing.length) {
    const error = new TicketFlowError('PANEL_BOT_PERMISSIONS');
    error.missingPermissions = missing;
    throw error;
  }
}

function assertMemberHostPermissions(channel, member) {
  const permissions = channel.permissionsFor(member);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)
    || !permissions.has(PermissionFlagsBits.SendMessagesInThreads)) {
    throw new TicketFlowError('REQUESTER_THREAD_PERMISSIONS');
  }
}

async function listStaffMembers(guild, channel, roleIds, requesterId = null) {
  if (roleIds.includes(guild.id)) throw new TicketFlowError('STAFF_ROLE_INVALID');
  const roles = roleIds.map((roleId) => guild.roles.cache.get(roleId));
  if (roles.some((role) => !role)) {
    throw new TicketFlowError('STAFF_ROLE_INVALID');
  }
  if (roleIds.length === 0) return [];

  const allMembers = await guild.members.fetch();
  const staffMembers = [...allMembers.values()].filter((member) => (
    !member.user.bot
    && member.id !== requesterId
    && hasRole(member, roleIds)
  ));
  if (staffMembers.length > MAX_PRIVATE_THREAD_MEMBERS) {
    throw new TicketFlowError('STAFF_TOO_LARGE');
  }
  if (staffMembers.some((member) => {
    const permissions = channel.permissionsFor(member);
    return !permissions?.has(PermissionFlagsBits.ViewChannel)
      || !permissions.has(PermissionFlagsBits.SendMessagesInThreads);
  })) {
    throw new TicketFlowError('STAFF_THREAD_PERMISSIONS');
  }
  return staffMembers;
}

async function addThreadMembers(thread, members) {
  for (let offset = 0; offset < members.length; offset += 20) {
    const batch = members.slice(offset, offset + 20);
    await Promise.all(batch.map((member) => thread.members.add(member.id)));
  }
}

async function findRecentNonceMessage(channel, nonce, limit = 50) {
  try {
    const messages = await channel.messages.fetch({ limit });
    return messages.find((message) => String(message.nonce ?? '') === String(nonce)) ?? null;
  } catch {
    return null;
  }
}

async function fetchPublishedMessage(channel, panel) {
  if (!panel.messageId) return null;
  try {
    return await channel.messages.fetch(panel.messageId);
  } catch (error) {
    if (isUnknownMessage(error)) return null;
    throw error;
  }
}

export async function publishTicketPanel(panelId, context) {
  const panels = context.database.collection(PANEL_COLLECTION);
  const token = randomUUID();
  const now = new Date();
  const lock = await panels.updateOne(
    {
      _id: panelId,
      $or: [
        { 'publishLock.expiresAt': { $exists: false } },
        { 'publishLock.expiresAt': { $lte: now } },
      ],
    },
    { $set: { publishLock: { token, expiresAt: new Date(now.getTime() + LOCK_DURATION_MS) } } },
  );
  if (lock.modifiedCount !== 1) throw new TicketFlowError('PANEL_BUSY');

  try {
    const panel = await panels.findOne({ _id: panelId });
    if (!panel) throw new TicketFlowError('PANEL_NOT_FOUND');
    if (!panel.channelId) throw new TicketFlowError('PANEL_CHANNEL_REQUIRED');
    if ((panel.options?.length ?? 0) > 25) throw new TicketFlowError('PANEL_OPTION_LIMIT');
    const activeOptions = (panel.options ?? []).filter((option) => option.active !== false);
    const invalidOptionNumbers = activeOptions
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => option.emoji && normalizeTicketEmoji(option.emoji) === null)
      .map(({ index }) => index + 1);
    if (invalidOptionNumbers.length) {
      const error = new TicketFlowError('PANEL_OPTION_EMOJI_INVALID');
      error.invalidOptionNumbers = invalidOptionNumbers;
      throw error;
    }
    const channel = await fetchChannel(context.guild, panel.channelId);
    if (!isTextChannel(channel)) throw new TicketFlowError('PANEL_CHANNEL_INVALID');
    await assertPanelBotPermissions(channel, context.guild, panel);
    const settings = await getTicketSettings(context.database);
    const payload = buildPublishedPanelPayload(panel, settings.enabled);
    let message = await fetchPublishedMessage(channel, panel);
    const nonce = eventNonce(`ticket-panel:${panel._id}`);
    if (!message) {
      message = await findRecentNonceMessage(channel, nonce);
    }
    if (message) {
      const { flags, ...editPayload } = payload;
      await message.edit(editPayload);
    } else {
      message = await channel.send({ ...payload, nonce, enforceNonce: true });
    }
    await panels.updateOne(
      { _id: panel._id, 'publishLock.token': token },
      { $set: { messageId: message.id, publishedAt: panel.publishedAt ?? now, updatedAt: now }, $unset: { publishLock: '' } },
    );
    return message;
  } finally {
    await panels.updateOne(
      { _id: panelId, 'publishLock.token': token },
      { $unset: { publishLock: '' } },
    ).catch(() => {});
  }
}

export async function refreshPublishedTicketPanel(panelId, context) {
  const panels = context.database.collection(PANEL_COLLECTION);
  const panel = await panels.findOne({ _id: panelId });
  if (!panel?.messageId || !panel.channelId) return false;
  const channel = await fetchChannel(context.guild, panel.channelId);
  if (!isTextChannel(channel)) {
    await panels.updateOne({ _id: panelId }, { $unset: { messageId: '' } });
    return false;
  }
  try {
    const message = await channel.messages.fetch(panel.messageId);
    const settings = await getTicketSettings(context.database);
    const { flags, ...editPayload } = buildPublishedPanelPayload(panel, settings.enabled);
    await message.edit(editPayload);
    return true;
  } catch (error) {
    if (isUnknownMessage(error)) {
      await panels.updateOne({ _id: panelId }, { $unset: { messageId: '' } });
      return false;
    }
    throw error;
  }
}

function panelOption(panel, optionId) {
  return panel?.options?.find((option) => option.id === optionId) ?? null;
}

function assertPanelMessage(interaction, panel, interactionType) {
  if (!panel?.active) throw new TicketFlowError('PANEL_INACTIVE');
  if (panel.interactionType !== interactionType) throw new TicketFlowError('PANEL_INACTIVE');
  if (!panel.messageId || panel.messageId !== interaction.message?.id
    || panel.channelId !== interaction.channelId) {
    throw new TicketFlowError('PANEL_INACTIVE');
  }
}

async function validateSelectedOption(interaction, panelId, optionId, context, interactionType) {
  const settings = await getTicketSettings(context.database);
  if (!settingsAreValid(settings) || !settings.enabled) {
    throw new TicketFlowError('TICKET_SYSTEM_DISABLED');
  }
  const panel = await context.database.collection(PANEL_COLLECTION).findOne({ _id: panelId });
  assertPanelMessage(interaction, panel, interactionType);
  const option = panelOption(panel, optionId);
  if (!option || option.active === false) throw new TicketFlowError('OPTION_INACTIVE');
  return { panel, option, settings };
}

async function openTicketModal(interaction, panelId, optionId, context, interactionType) {
  const { panel, option, settings } = await validateSelectedOption(interaction, panelId, optionId, context, interactionType);
  if (option.action === 'reply') {
    if (!option.responseText) throw new TicketFlowError('OPTION_INACTIVE');
    await replyV2(interaction, option.responseText, { ephemeral: true });
    return;
  }
  if (option.action !== 'ticket') throw new TicketFlowError('OPTION_INACTIVE');
  if (interaction.user.bot) throw new TicketFlowError('INVALID_MEMBER');
  const limit = optionLimit(option, settings);
  if (await getMemberActiveTicketCount(context.database, interaction.user.id, option.id) >= limit) {
    throw new TicketFlowError('TICKET_LIMIT_REACHED');
  }
  const threadChannelId = option.threadChannelId || settings.defaultThreadChannelId;
  const channel = await fetchChannel(interaction.guild, threadChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new TicketFlowError('THREAD_CHANNEL_INVALID');
  }
  const requestId = randomUUID();
  const now = new Date();
  await context.database.collection(REQUESTS).insertOne({
    _id: requestId,
    ownerId: interaction.user.id,
    panelId: panel._id,
    optionId: option.id,
    sourceMessageId: interaction.message.id,
    status: 'modal',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
  });
  const modal = new ModalBuilder()
    .setCustomId(`ticket:reason:${requestId}`)
    .setTitle('Solicitar atendimento')
    .addComponents(textInput(
      'reason',
      'Qual é o motivo do seu ticket?',
      'Descreva o que aconteceu e como podemos ajudar',
      4000,
    ));
  await interaction.showModal(modal);
}

async function handlePublishedPanelSelection(interaction, context) {
  if (interaction.isButton()) {
    const match = /^ticket:option:([^:]+):([^:]+)$/.exec(interaction.customId);
    if (!match) return false;
    try {
      await openTicketModal(interaction, match[1], match[2], context, 'buttons');
    } catch (error) {
      await replyV2(interaction, errorMessage(error), { ephemeral: true });
    }
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket:menu:')) {
    const panelId = interaction.customId.slice('ticket:menu:'.length);
    try {
      await openTicketModal(interaction, panelId, interaction.values[0], context, 'select');
    } catch (error) {
      await replyV2(interaction, errorMessage(error), { ephemeral: true });
    }
    return true;
  }
  return false;
}

async function createOpeningRequest(interaction, context) {
  await interaction.deferReply({ ephemeral: true });
  let requestId;
  let ticketId;
  let thread;
  let reserved = false;
  let setupCompleted = false;
  try {
    const requestMatch = /^ticket:reason:([0-9a-f-]{36})$/i.exec(interaction.customId);
    if (!requestMatch) throw new TicketFlowError('REQUEST_EXPIRED');
    requestId = requestMatch[1];
    const now = new Date();
    const request = await context.database.collection(REQUESTS).findOneAndUpdate(
      {
        _id: requestId,
        ownerId: interaction.user.id,
        status: 'modal',
        expiresAt: { $gt: now },
      },
      {
        $set: {
          status: 'creating',
          reason: interaction.fields.getTextInputValue('reason').trim(),
          submittedAt: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      { returnDocument: 'after' },
    );
    if (!request) throw new TicketFlowError('REQUEST_USED');
    if (request.reason.length < 5) throw new TicketFlowError('INVALID_REASON');

    const settings = await getTicketSettings(context.database);
    if (!settingsAreValid(settings) || !settings.enabled) throw new TicketFlowError('TICKET_SYSTEM_DISABLED');
    const panel = await context.database.collection(PANEL_COLLECTION).findOne({ _id: request.panelId });
    if (!panel?.active || panel.messageId !== request.sourceMessageId) throw new TicketFlowError('PANEL_INACTIVE');
    const option = panelOption(panel, request.optionId);
    if (!option || option.active === false || option.action !== 'ticket') {
      throw new TicketFlowError('OPTION_INACTIVE');
    }
    const limit = optionLimit(option, settings);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new TicketFlowError('TICKET_LIMIT_REACHED');
    const threadChannelId = option.threadChannelId || settings.defaultThreadChannelId;
    const host = await fetchChannel(interaction.guild, threadChannelId);
    if (!host || host.type !== ChannelType.GuildText) throw new TicketFlowError('THREAD_CHANNEL_INVALID');
    const botMember = await interaction.guild.members.fetchMe();
    assertHostBotPermissions(host, botMember);
    const requester = await interaction.guild.members.fetch(interaction.user.id);
    assertMemberHostPermissions(host, requester);
    const roleIds = teamRoleIds(option, settings);
    const staffMembers = await listStaffMembers(interaction.guild, host, roleIds, requester.id);
    const initialMessage = option.initialMessage || settings.defaultInitialMessage;
    const prefix = option.prefix || 'ticket';

    ticketId = await allocateTicketNumber(context.database);
    const ticketKey = String(ticketId);
    reserved = await reserveMemberTicketSlot(context.database, requester.id, ticketKey, option.id, limit);
    if (!reserved) throw new TicketFlowError('TICKET_LIMIT_REACHED');

    const ticket = {
      _id: ticketKey,
      ticketId,
      requestId,
      ownerId: requester.id,
      ownerName: actorName(requester),
      panelId: panel._id,
      panelName: panel.name,
      optionId: option.id,
      optionLabel: option.label,
      sourcePanelMessageId: panel.messageId,
      threadChannelId: host.id,
      threadId: null,
      controlMessageId: null,
      status: 'open',
      setupState: 'provisioning',
      reason: request.reason,
      staffRoleIds: roleIds,
      prefix,
      initialMessage,
      assignedStaffId: null,
      assignedAt: null,
      participantIds: [],
      createdAt: now,
      closedAt: null,
      endedAt: null,
      transcriptMessageId: null,
      finalization: { state: 'none', attempts: 0 },
      slotReleased: false,
      initialMessageSent: false,
      createdByRequestId: requestId,
    };
    await context.database.collection(TICKETS).insertOne(ticket);

    thread = await host.threads.create({
      name: safeThreadName(prefix, requester.displayName, ticketId),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: threadAutoArchiveDuration(interaction.guild),
      reason: `Ticket #${ticketId} aberto por ${requester.user.tag}`,
    });
    await context.database.collection(TICKETS).updateOne(
      { _id: ticketKey, status: 'open', setupState: 'provisioning' },
      { $set: { threadId: thread.id } },
    );
    await thread.members.add(requester.id);
    await addThreadMembers(thread, staffMembers);

    if (initialMessage) {
      const initialNonce = eventNonce(`ticket-initial:${ticketKey}`);
      let initial = await findRecentNonceMessage(thread, initialNonce);
      if (!initial) {
        initial = await thread.send({
          content: initialMessage,
          allowedMentions: ALLOWED_MENTIONS,
          nonce: initialNonce,
          enforceNonce: true,
        });
      }
      await context.database.collection(TICKETS).updateOne(
        { _id: ticketKey },
        { $set: { initialMessageSent: true, initialMessageId: initial.id } },
      );
    }

    const currentTicket = await context.database.collection(TICKETS).findOne({ _id: ticketKey });
    const controlNonce = eventNonce(`ticket-control:${ticketKey}`);
    let control = await findRecentNonceMessage(thread, controlNonce);
    if (!control) {
      const payloadTicket = { ...currentTicket, status: 'open' };
      control = await thread.send({
        ...ticketControlMessagePayload(payloadTicket, interaction.guild),
        nonce: controlNonce,
        enforceNonce: true,
      });
    }
    await control.pin();
    const setupResult = await context.database.collection(TICKETS).updateOne(
      { _id: ticketKey, status: 'open', setupState: 'provisioning' },
      { $set: { setupState: 'complete', controlMessageId: control.id, openedAt: new Date() } },
    );
    if (setupResult.modifiedCount !== 1) throw new TicketFlowError('TICKET_ACTION_BUSY');
    setupCompleted = true;
    await context.database.collection(REQUESTS).updateOne(
      { _id: requestId },
      { $set: { status: 'complete', ticketId: ticketKey } },
    );
    const opened = await context.database.collection(TICKETS).findOne({ _id: ticketKey });
    await recordTicketEvent(context, opened, {
      eventId: requestId,
      type: 'opened',
      actorId: requester.id,
      details: `Painel: ${panel.name} · opção: ${option.label}`,
    });
    await interaction.editReply({
      content: `Seu ticket foi criado: <#${thread.id}>`,
      allowedMentions: ALLOWED_MENTIONS,
    });
  } catch (error) {
    let storedTicket = null;
    let ticketLookupSucceeded = !ticketId;
    if (ticketId) {
      try {
        storedTicket = await context.database.collection(TICKETS).findOne({ _id: String(ticketId) });
        ticketLookupSucceeded = true;
      } catch {
        // Keep the thread and reservation if MongoDB cannot tell us whether setup committed.
      }
    }
    const ticketIsReady = setupCompleted || storedTicket?.setupState === 'complete';
    if (ticketIsReady) {
      if (requestId) {
        await context.database.collection(REQUESTS).updateOne(
          { _id: requestId },
          { $set: { status: 'complete', ticketId: String(ticketId) } },
        ).catch(() => {});
      }
      if (storedTicket) {
        await recordTicketEvent(context, storedTicket, {
          eventId: requestId,
          type: 'opened',
          actorId: storedTicket.ownerId,
          details: `Painel: ${storedTicket.panelName} · opção: ${storedTicket.optionLabel}`,
        }).catch(() => {});
      }
      if (!(error instanceof TicketFlowError)) {
        console.error(`[Tickets] Falha após preparar o ticket (${error?.name ?? 'Erro'}); o tópico foi preservado.`);
      }
      const threadId = storedTicket?.threadId ?? thread?.id;
      await interaction.editReply({
        content: threadId ? `Seu ticket foi criado: <#${threadId}>` : 'Seu ticket foi criado e está sendo reconciliado.',
        allowedMentions: ALLOWED_MENTIONS,
      }).catch(() => {});
      return;
    }

    const confirmedUncommitted = ticketLookupSucceeded
      && (!storedTicket || storedTicket.setupState === 'provisioning');
    if (confirmedUncommitted && thread) {
      await thread.delete('Falha ao preparar o ticket').catch(() => {});
    }
    if (ticketId && reserved && confirmedUncommitted) {
      await releaseMemberTicketSlot(context.database, interaction.user.id, String(ticketId)).catch(() => {});
      if (confirmedUncommitted) {
        await context.database.collection(TICKETS)
          .deleteOne({ _id: String(ticketId), setupState: 'provisioning' }).catch(() => {});
      }
    }
    if (requestId && confirmedUncommitted) {
      await context.database.collection(REQUESTS).updateOne(
        { _id: requestId },
        { $set: { status: 'failed', failureCode: error?.code ?? 'UNKNOWN' } },
      ).catch(() => {});
    }
    if (!(error instanceof TicketFlowError)) {
      console.error(`[Tickets] Falha ao criar ticket (${error?.name ?? 'Erro'}).`);
    }
    await interaction.editReply({ content: errorMessage(error), allowedMentions: ALLOWED_MENTIONS });
  }
}

async function deliverTicketEvent(context, event) {
  if (event.logState === 'complete' || event.logState === 'disabled') return;
  const ticket = await context.database.collection(TICKETS).findOne({ _id: String(event.ticketId) });
  if (!ticket) return;
  if (['resolved', 'ended'].includes(event.type) && ticket.status !== 'ended') return;
  const settings = await getTicketSettings(context.database);
  if (settings.logsChannelId && settings.logsChannelId === settings.transcriptsChannelId) {
    await context.database.collection(EVENTS).updateOne(
      { _id: event._id },
      { $set: { logState: 'pending', lastAttemptAt: new Date(), lastFailure: 'LOG_TRANSCRIPT_CHANNELS_MUST_DIFFER' } },
    );
    return;
  }
  if (!settings.logsChannelId) {
    await context.database.collection(EVENTS).updateOne(
      { _id: event._id },
      { $set: { logState: 'pending', lastAttemptAt: new Date(), lastFailure: 'LOG_CHANNEL_NOT_CONFIGURED' } },
    );
    return;
  }
  const channel = await fetchChannel(context.guild, settings.logsChannelId);
  if (!isTextChannel(channel)) {
    await context.database.collection(EVENTS).updateOne(
      { _id: event._id },
      { $set: { logState: 'pending', lastAttemptAt: new Date(), lastFailure: 'LOG_CHANNEL_UNAVAILABLE' } },
    );
    return;
  }
  const url = ticketLink(context.guildId, ticket?.threadId);
  const embed = new EmbedBuilder()
    .setColor(event.type === 'finalization_failed' ? 0xed4245 : 0x5865f2)
    .setTitle(`${eventLabel(event.type)} · Ticket #${String(event.ticketId).padStart(4, '0')}`.slice(0, 256))
    .addFields(
      { name: 'Solicitante', value: ticket ? `<@${ticket.ownerId}>` : 'Membro indisponível', inline: true },
      { name: 'Responsável pela ação', value: event.actorId ? `<@${event.actorId}>` : 'Jinx', inline: true },
      { name: 'Evento', value: eventLabel(event.type), inline: true },
      { name: 'Painel e opção', value: ticket ? `${ticket.panelName} · ${ticket.optionLabel}`.slice(0, 1024) : 'Origem indisponível' },
      { name: 'Data', value: new Date(event.createdAt).toLocaleString('pt-BR', { timeZone: 'UTC' }), inline: true },
      { name: 'Tópico', value: url ? `[Abrir ticket](${url})` : 'Tópico indisponível', inline: true },
      ...(event.details ? [{ name: 'Detalhes', value: String(event.details).slice(0, 1024) }] : []),
    )
    .setFooter({ text: `Evento ${event._id}` })
    .setTimestamp(new Date(event.createdAt));
  const nonce = eventNonce(`ticket-event:${event._id}`);
  try {
    let message = await findRecentNonceMessage(channel, nonce, 50);
    if (!message) {
      message = await channel.send({
        embeds: [embed],
        allowedMentions: ALLOWED_MENTIONS,
        nonce,
        enforceNonce: true,
      });
    }
    await context.database.collection(EVENTS).updateOne(
      { _id: event._id },
      { $set: { logState: 'complete', logMessageId: message.id, loggedAt: new Date() } },
    );
  } catch (error) {
    await context.database.collection(EVENTS).updateOne(
      { _id: event._id },
      { $set: { logState: 'pending', lastAttemptAt: new Date(), lastFailure: error?.codeName ?? error?.name ?? 'DISCORD_ERROR' } },
    ).catch(() => {});
    console.error(`[Tickets] Falha ao enviar log operacional (${error?.name ?? 'Erro'}).`);
  }
}

async function persistTicketEvent(context, ticket, {
  eventId = randomUUID(),
  type,
  actorId = null,
  details = null,
}) {
  const events = context.database.collection(EVENTS);
  const event = {
    _id: String(eventId),
    ticketId: ticket.ticketId,
    type,
    actorId,
    details,
    createdAt: new Date(),
    logState: 'pending',
  };
  try {
    await events.insertOne(event);
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return events.findOne({ _id: String(eventId) });
}

async function recordTicketEvent(context, ticket, eventData) {
  const stored = await persistTicketEvent(context, ticket, eventData);
  await deliverTicketEvent(context, stored);
}

async function claimTicketAction(context, ticketId, actorId, action, allowedStatuses = ['open']) {
  const now = new Date();
  const token = randomUUID();
  const result = await context.database.collection(TICKETS).updateOne(
    {
      _id: String(ticketId),
      status: { $in: allowedStatuses },
      setupState: 'complete',
      'finalization.state': { $ne: 'pending' },
      $or: [
        { 'actionLock.expiresAt': { $exists: false } },
        { 'actionLock.expiresAt': { $lte: now } },
      ],
    },
    {
      $set: {
        actionLock: {
          token,
          action,
          actorId,
          acquiredAt: now,
          expiresAt: new Date(now.getTime() + LOCK_DURATION_MS),
        },
      },
    },
  );
  if (result.modifiedCount !== 1) {
    const ticket = await context.database.collection(TICKETS).findOne({ _id: String(ticketId) });
    if (!ticket) throw new TicketFlowError('TICKET_NOT_FOUND');
    if (ticket.status === 'ended') throw new TicketFlowError('TICKET_ENDED');
    if (ticket.finalization?.state === 'pending') throw new TicketFlowError('TICKET_FINALIZING');
    if (ticket.actionLock?.expiresAt > now) throw new TicketFlowError('TICKET_ACTION_BUSY');
    throw new TicketFlowError(allowedStatuses.includes('closed') ? 'TICKET_NOT_CLOSED' : 'TICKET_NOT_OPEN');
  }
  const heartbeat = setInterval(() => {
    const heartbeatAt = new Date();
    void context.database.collection(TICKETS).updateOne(
      { _id: String(ticketId), 'actionLock.token': token },
      { $set: { 'actionLock.expiresAt': new Date(heartbeatAt.getTime() + LOCK_DURATION_MS) } },
    ).catch(() => {});
  }, 30_000);
  heartbeat.unref?.();
  return { token, heartbeat };
}

async function releaseTicketAction(context, ticketId, token, heartbeat) {
  clearInterval(heartbeat);
  await context.database.collection(TICKETS).updateOne(
    { _id: String(ticketId), 'actionLock.token': token },
    { $unset: { actionLock: '' } },
  ).catch(() => {});
}

async function getTicketFromControl(interaction, context, ticketId) {
  const ticket = await context.database.collection(TICKETS).findOne({ _id: String(ticketId) });
  if (!ticket) throw new TicketFlowError('TICKET_NOT_FOUND');
  if (ticket.setupState !== 'complete') throw new TicketFlowError('TICKET_ACTION_BUSY');
  if (ticket.threadId !== interaction.channelId || !isPrivateThread(interaction.channel)) {
    throw new TicketFlowError('TICKET_WRONG_CHANNEL');
  }
  if (interaction.message?.id !== ticket.controlMessageId) {
    throw new TicketFlowError('TICKET_CONTROL_STALE');
  }
  return ticket;
}

async function getTicketThread(ticket, guild) {
  const thread = await fetchChannel(guild, ticket.threadId);
  if (!isPrivateThread(thread)) throw new TicketFlowError('THREAD_MISSING');
  return thread;
}

async function updateTicketControl(context, ticket, { recreate = true } = {}) {
  const thread = await getTicketThread(ticket, context.guild);
  let message = null;
  if (ticket.controlMessageId) {
    try {
      message = await thread.messages.fetch(ticket.controlMessageId);
    } catch (error) {
      if (!isUnknownMessage(error)) throw error;
    }
  }
  if (!message && recreate && ticket.status !== 'ended') {
    const nonce = eventNonce(`ticket-control:${ticket._id}`);
    message = await findRecentNonceMessage(thread, nonce);
    if (!message) {
      message = await thread.send({
        ...ticketControlMessagePayload(ticket, context.guild),
        nonce,
        enforceNonce: true,
      });
    } else {
      const payload = ticketControlMessagePayload(ticket, context.guild);
      await message.edit(payload);
    }
    await message.pin();
    await context.database.collection(TICKETS).updateOne(
      { _id: ticket._id },
      { $set: { controlMessageId: message.id } },
    );
    return message;
  }
  if (message) {
    await message.edit(ticketControlMessagePayload(ticket, context.guild));
  }
  return message;
}

async function refreshTicketFromDatabase(context, ticketId) {
  const ticket = await context.database.collection(TICKETS).findOne({ _id: String(ticketId) });
  if (!ticket || !ticket.threadId) return;
  await updateTicketControl(context, ticket).catch((error) => {
    console.error(`[Tickets] Falha ao atualizar painel do ticket ${ticket.ticketId} (${error?.name ?? 'Erro'}).`);
  });
}

async function addStaffMembersToThread(context, ticket, thread) {
  const host = await fetchChannel(context.guild, ticket.threadChannelId);
  if (!host || host.type !== ChannelType.GuildText) throw new TicketFlowError('THREAD_CHANNEL_INVALID');
  const staff = await listStaffMembers(context.guild, host, ticket.staffRoleIds ?? [], ticket.ownerId);
  await addThreadMembers(thread, staff);
}

async function authorizedStaffOrRequester(interaction, ticket) {
  const requester = interaction.user.id === ticket.ownerId;
  const staff = isStaff(interaction.member, ticket);
  return { requester, staff };
}

function transcriptFilename(ticket) {
  return `ticket-${String(ticket.ticketId).padStart(4, '0')}.html`;
}

async function findTranscriptDelivery(channel, ticket) {
  const filename = transcriptFilename(ticket);
  const marker = `Transcript do ticket #${ticket.ticketId}`;
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    return messages.find((message) => message.content?.includes(marker)
      && message.attachments.some((attachment) => attachment.name === filename)) ?? null;
  } catch {
    return null;
  }
}

async function claimFinalization(context, ticketId, actorId) {
  const now = new Date();
  const token = randomUUID();
  const result = await context.database.collection(TICKETS).updateOne(
    {
      _id: String(ticketId),
      status: { $in: ['open', 'closed'] },
      setupState: 'complete',
      'finalization.state': { $ne: 'complete' },
      $or: [
        { 'actionLock.expiresAt': { $exists: false } },
        { 'actionLock.expiresAt': { $lte: now } },
      ],
    },
    {
      $set: {
        'finalization.state': 'pending',
        'finalization.requestedBy': actorId,
        'finalization.startedAt': now,
        'finalization.lastFailure': null,
        actionLock: {
          token,
          action: 'finalize',
          actorId,
          acquiredAt: now,
          expiresAt: new Date(now.getTime() + LOCK_DURATION_MS),
        },
      },
      $inc: { 'finalization.attempts': 1 },
    },
  );
  if (result.modifiedCount !== 1) {
    const ticket = await context.database.collection(TICKETS).findOne({ _id: String(ticketId) });
    if (!ticket) throw new TicketFlowError('TICKET_NOT_FOUND');
    if (ticket.status === 'ended' || ticket.finalization?.state === 'complete') {
      throw new TicketFlowError('TICKET_ENDED');
    }
    if (ticket.finalization?.state === 'pending') throw new TicketFlowError('TICKET_FINALIZING');
    if (ticket.actionLock?.expiresAt > now) throw new TicketFlowError('TICKET_ACTION_BUSY');
    throw new TicketFlowError('TICKET_ENDED');
  }
  const heartbeat = setInterval(() => {
    const heartbeatAt = new Date();
    void context.database.collection(TICKETS).updateOne(
      { _id: String(ticketId), 'actionLock.token': token },
      { $set: { 'actionLock.expiresAt': new Date(heartbeatAt.getTime() + LOCK_DURATION_MS) } },
    ).catch(() => {});
  }, 30_000);
  heartbeat.unref?.();
  return { token, heartbeat };
}

async function bestEffortFinalizedThreadAction(context, ticket, thread) {
  try {
    const settings = await getTicketSettings(context.database);
    if (settings.resolvedThreadBehavior === 'delete') {
      await thread.delete(`Ticket #${ticket.ticketId} encerrado`);
      await context.database.collection(TICKETS).updateOne(
        { _id: ticket._id, status: 'ended' },
        { $set: { threadFinalActionAt: new Date(), threadDeletedAt: new Date() } },
      );
    } else {
      await thread.setArchived(true, `Ticket #${ticket.ticketId} encerrado`);
      await context.database.collection(TICKETS).updateOne(
        { _id: ticket._id, status: 'ended' },
        { $set: { threadFinalActionAt: new Date() } },
      );
    }
  } catch (error) {
    await recordTicketEvent(context, ticket, {
      eventId: `${ticket._id}:thread-final-action-failed`,
      type: 'finalization_failed',
      actorId: ticket.finalization?.requestedBy ?? null,
      details: 'O transcript foi enviado, mas o tópico não pôde ser arquivado ou excluído automaticamente.',
    }).catch(() => {});
    console.error(`[Tickets] Não foi possível arquivar ou excluir o tópico ${ticket.ticketId} (${error?.name ?? 'Erro'}).`);
  }
}

async function finalizeTicket(context, ticketId, actorId, { recovery = false } = {}) {
  const { token, heartbeat } = await claimFinalization(context, ticketId, actorId);
  let current = await context.database.collection(TICKETS).findOne({ _id: String(ticketId) });
  try {
    await refreshTicketFromDatabase(context, ticketId).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar controle durante a resolução (${error?.name ?? 'Erro'}).`);
    });
    const thread = await getTicketThread(current, context.guild);
    const settings = await getTicketSettings(context.database);
    if (settings.logsChannelId && settings.logsChannelId === settings.transcriptsChannelId) {
      throw new TicketFlowError('RESOLVER_CHANNEL_MISSING');
    }
    const transcriptChannel = await fetchChannel(context.guild, settings.transcriptsChannelId);
    if (!isTextChannel(transcriptChannel)) throw new TicketFlowError('RESOLVER_CHANNEL_MISSING');

    const resolvedAt = new Date();
    let transcriptMessage = await findTranscriptDelivery(transcriptChannel, current);
    if (!transcriptMessage) {
      const messages = await fetchAllThreadMessages(thread);
      const staff = current.assignedStaffId
        ? await context.guild.members.fetch(current.assignedStaffId).catch(() => null)
        : null;
      const transcriptTicket = {
        ...current,
        ownerName: current.ownerName || current.ownerId,
        assignedStaffName: staff ? actorName(staff) : null,
      };
      const html = createTranscriptHtml(transcriptTicket, messages, resolvedAt, context.guildId);
      const buffer = Buffer.from(html, 'utf8');
      const maxUploadSize = context.guild.maximumUploadLimit || 10 * 1024 * 1024;
      if (buffer.length > maxUploadSize) throw new TicketFlowError('TRANSCRIPT_TOO_LARGE');
      const marker = `Transcript do ticket #${current.ticketId}`;
      transcriptMessage = await transcriptChannel.send({
        content: `${marker}\nSolicitante: <@${current.ownerId}> · Responsável: ${current.assignedStaffId ? `<@${current.assignedStaffId}>` : 'nenhum'}\nMotivo: ${current.reason.slice(0, 1600)}${current.reason.length > 1600 ? '… (continua no arquivo)' : ''}`,
        files: [new AttachmentBuilder(buffer, { name: transcriptFilename(current) })],
        allowedMentions: ALLOWED_MENTIONS,
        nonce: eventNonce(`ticket-transcript:${current._id}`),
        enforceNonce: true,
      });
    }

    const endedAt = new Date();
    const resolvedEvent = await persistTicketEvent(context, current, {
      eventId: `${current._id}:resolved`,
      type: 'resolved',
      actorId,
      details: 'O transcript HTML foi enviado ao canal configurado.',
    });
    const endedEvent = await persistTicketEvent(context, current, {
      eventId: `${current._id}:ended`,
      type: 'ended',
      actorId,
      details: `Mensagem do transcript: ${transcriptMessage.id}`,
    });
    const completed = await context.database.collection(TICKETS).updateOne(
      { _id: current._id, status: { $in: ['open', 'closed'] }, 'actionLock.token': token },
      {
        $set: {
          status: 'ended',
          endedAt,
          resolvedAt,
          resolvedBy: actorId,
          transcriptMessageId: transcriptMessage.id,
          transcriptChannelId: transcriptChannel.id,
          'finalization.state': 'complete',
          'finalization.completedAt': endedAt,
        },
        $unset: { actionLock: '' },
      },
    );
    if (completed.modifiedCount !== 1) {
      const latest = await context.database.collection(TICKETS).findOne({ _id: current._id });
      if (latest?.status !== 'ended') throw new TicketFlowError('TICKET_FINALIZING');
      current = latest;
    } else {
      current = await context.database.collection(TICKETS).findOne({ _id: current._id });
    }
    await releaseMemberTicketSlot(context.database, current.ownerId, current._id);
    await context.database.collection(TICKETS).updateOne(
      { _id: current._id },
      { $set: { slotReleased: true } },
    );
    await Promise.all([resolvedEvent, endedEvent].map((event) => deliverTicketEvent(context, event).catch((error) => {
      console.error(`[Tickets] Falha ao enviar log de encerramento (${error?.name ?? 'Erro'}).`);
    })));
    await updateTicketControl(context, current, { recreate: false }).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar painel encerrado (${error?.name ?? 'Erro'}).`);
    });
    await bestEffortFinalizedThreadAction(context, current, thread);
    return { ticket: current, transcriptMessage };
  } catch (error) {
    const latest = await context.database.collection(TICKETS).findOne({ _id: String(ticketId) }).catch(() => null);
    if (latest?.status !== 'ended') {
      await context.database.collection(TICKETS).updateOne(
        { _id: String(ticketId), 'actionLock.token': token, status: { $in: ['open', 'closed'] } },
        {
          $set: {
            'finalization.state': 'failed',
            'finalization.lastFailure': error?.code ?? error?.codeName ?? error?.name ?? 'UNKNOWN',
            'finalization.failedAt': new Date(),
          },
          $unset: { actionLock: '' },
        },
      ).catch(() => {});
      const failedTicket = latest ?? current;
      await recordTicketEvent(context, failedTicket, {
        eventId: `${failedTicket._id}:finalization-failed:${failedTicket.finalization?.attempts ?? 1}`,
        type: 'finalization_failed',
        actorId,
        details: 'A geração ou o envio do transcript falhou. O ticket continua disponível para uma nova tentativa.',
      }).catch(() => {});
      await refreshTicketFromDatabase(context, ticketId);
    }
    if (!(error instanceof TicketFlowError)) {
      console.error(`[Tickets] Falha ao finalizar ticket (${error?.name ?? 'Erro'}).`);
    }
    if (recovery) return { error };
    throw error;
  } finally {
    clearInterval(heartbeat);
    await context.database.collection(TICKETS).updateOne(
      { _id: String(ticketId), 'actionLock.token': token },
      { $unset: { actionLock: '' } },
    ).catch(() => {});
  }
}

async function withTicketAction(context, ticket, actorId, action, statuses, callback) {
  const { token, heartbeat } = await claimTicketAction(context, ticket.ticketId, actorId, action, statuses);
  try {
    const fresh = await context.database.collection(TICKETS).findOne({ _id: ticket._id });
    return await callback(fresh, token);
  } finally {
    await releaseTicketAction(context, ticket.ticketId, token, heartbeat);
  }
}

async function logTicketAction(context, ticket, interaction, type, details = null) {
  await recordTicketEvent(context, ticket, {
    eventId: interaction.id,
    type,
    actorId: interaction.user.id,
    details,
  }).catch((error) => console.error(`[Tickets] Falha ao persistir log da ação ${type} (${error?.name ?? 'Erro'}).`));
}

async function answerTicketAction(interaction, content) {
  if (interaction.deferred && interaction.isButton() && !interaction.replied) {
    await interaction.editReply({ content, allowedMentions: ALLOWED_MENTIONS });
    return;
  }
  await replyV2(interaction, content, { ephemeral: true });
}

async function closeTicket(interaction, context, ticket) {
  const { requester, staff } = await authorizedStaffOrRequester(interaction, ticket);
  if (!requester && !staff) throw new TicketFlowError('REQUESTER_ONLY');
  await withTicketAction(context, ticket, interaction.user.id, 'close', ['open'], async (fresh, token) => {
    const now = new Date();
    const updated = await context.database.collection(TICKETS).updateOne(
      { _id: fresh._id, status: 'open', 'actionLock.token': token },
      { $set: { status: 'closed', closedAt: now, closedBy: interaction.user.id } },
    );
    if (updated.modifiedCount !== 1) throw new TicketFlowError('TICKET_ACTION_BUSY');
    const closed = await context.database.collection(TICKETS).findOne({ _id: fresh._id });
    await logTicketAction(context, closed, interaction, 'closed');
    await updateTicketControl(context, closed).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar controle após fechamento (${error?.name ?? 'Erro'}).`);
    });
    const thread = await getTicketThread(closed, context.guild);
    await thread.setArchived(true, `Ticket #${closed.ticketId} fechado`).catch(async (error) => {
      await recordTicketEvent(context, closed, {
        eventId: `${closed._id}:close-archive-failed:${interaction.id}`,
        type: 'finalization_failed',
        actorId: interaction.user.id,
        details: 'O ticket foi fechado, mas o tópico não pôde ser arquivado automaticamente.',
      }).catch(() => {});
      console.error(`[Tickets] Falha ao arquivar ticket fechado (${error?.name ?? 'Erro'}).`);
    });
  });
  await answerTicketAction(interaction, 'Ticket fechado. Ele pode ser reaberto conforme as permissões configuradas.');
}

async function reopenTicket(interaction, context, ticket) {
  const { requester, staff } = await authorizedStaffOrRequester(interaction, ticket);
  const settings = await getTicketSettings(context.database);
  if (!staff && !(requester && settings.requesterCanReopen)) throw new TicketFlowError('STAFF_ONLY');
  await withTicketAction(context, ticket, interaction.user.id, 'reopen', ['closed'], async (fresh, token) => {
    const thread = await getTicketThread(fresh, context.guild);
    await thread.setArchived(false, `Ticket #${fresh.ticketId} reaberto`);
    try {
      await addStaffMembersToThread(context, fresh, thread);
    } catch (error) {
      await thread.setArchived(true).catch(() => {});
      throw error;
    }
    const now = new Date();
    const updated = await context.database.collection(TICKETS).updateOne(
      { _id: fresh._id, status: 'closed', 'actionLock.token': token },
      { $set: { status: 'open', reopenedAt: now, reopenedBy: interaction.user.id } },
    );
    if (updated.modifiedCount !== 1) {
      await thread.setArchived(true).catch(() => {});
      throw new TicketFlowError('TICKET_ACTION_BUSY');
    }
    const reopened = await context.database.collection(TICKETS).findOne({ _id: fresh._id });
    await logTicketAction(context, reopened, interaction, 'reopened');
    await updateTicketControl(context, reopened).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar controle após reabertura (${error?.name ?? 'Erro'}).`);
    });
  });
  await answerTicketAction(interaction, 'Ticket reaberto.');
}

async function assumeTicket(interaction, context, ticket) {
  if (!isStaff(interaction.member, ticket)) throw new TicketFlowError('STAFF_ONLY');
  if (ticket.assignedStaffId) {
    if (ticket.assignedStaffId === interaction.user.id) {
      await answerTicketAction(interaction, 'Você já é o atendente responsável por este ticket.');
      return;
    }
    throw new TicketFlowError('ASSIGNEE_EXISTS');
  }
  await withTicketAction(context, ticket, interaction.user.id, 'assign', ['open'], async (fresh, token) => {
    if (fresh.assignedStaffId) throw new TicketFlowError('ASSIGNEE_EXISTS');
    const thread = await getTicketThread(fresh, context.guild);
    await thread.members.add(interaction.user.id);
    const now = new Date();
    const updated = await context.database.collection(TICKETS).updateOne(
      {
        _id: fresh._id,
        status: 'open',
        'actionLock.token': token,
        $or: [{ assignedStaffId: null }, { assignedStaffId: { $exists: false } }],
      },
      { $set: { assignedStaffId: interaction.user.id, assignedAt: now } },
    );
    if (updated.modifiedCount !== 1) throw new TicketFlowError('ASSIGNEE_EXISTS');
    const assigned = await context.database.collection(TICKETS).findOne({ _id: fresh._id });
    await logTicketAction(context, assigned, interaction, 'assigned');
    await thread.send({
      content: `O atendimento foi assumido por **${actorName(interaction.member)}**.`,
      allowedMentions: ALLOWED_MENTIONS,
    }).catch((error) => {
      console.error(`[Tickets] Falha ao anunciar o atendente (${error?.name ?? 'Erro'}).`);
    });
    await updateTicketControl(context, assigned).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar controle após assumir (${error?.name ?? 'Erro'}).`);
    });
  });
  await answerTicketAction(interaction, 'Você assumiu o atendimento.');
}

async function transferTicket(interaction, context, ticket, targetId) {
  if (!isStaff(interaction.member, ticket)) throw new TicketFlowError('STAFF_ONLY');
  await withTicketAction(context, ticket, interaction.user.id, 'transfer', ['open'], async (fresh, token) => {
    if (!fresh.assignedStaffId) throw new TicketFlowError('ASSIGNEE_REQUIRED');
    if (targetId === fresh.assignedStaffId) throw new TicketFlowError('INVALID_MEMBER');
    const target = await context.guild.members.fetch(targetId).catch(() => null);
    if (!target || target.user.bot || !isStaff(target, fresh)) throw new TicketFlowError('INVALID_MEMBER');
    const thread = await getTicketThread(fresh, context.guild);
    const host = await fetchChannel(context.guild, fresh.threadChannelId);
    if (!host || host.type !== ChannelType.GuildText) throw new TicketFlowError('THREAD_CHANNEL_INVALID');
    const permissions = host.permissionsFor(target);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)
      || !permissions.has(PermissionFlagsBits.SendMessagesInThreads)) {
      throw new TicketFlowError('STAFF_THREAD_PERMISSIONS');
    }
    await thread.members.add(target.id);
    const now = new Date();
    const updated = await context.database.collection(TICKETS).updateOne(
      { _id: fresh._id, status: 'open', assignedStaffId: fresh.assignedStaffId, 'actionLock.token': token },
      { $set: { assignedStaffId: target.id, assignedAt: now, lastTransferredFromId: fresh.assignedStaffId } },
    );
    if (updated.modifiedCount !== 1) throw new TicketFlowError('TICKET_ACTION_BUSY');
    const transferred = await context.database.collection(TICKETS).findOne({ _id: fresh._id });
    await logTicketAction(context, transferred, interaction, 'transferred', `Novo atendente: <@${target.id}>`);
    await thread.send({
      content: `A responsabilidade pelo atendimento foi transferida para **${actorName(target)}**.`,
      allowedMentions: ALLOWED_MENTIONS,
    }).catch((error) => {
      console.error(`[Tickets] Falha ao anunciar a transferência (${error?.name ?? 'Erro'}).`);
    });
    await updateTicketControl(context, transferred).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar controle após transferência (${error?.name ?? 'Erro'}).`);
    });
  });
  await answerTicketAction(interaction, 'Responsabilidade transferida.');
}

async function releaseTicketAssignee(interaction, context, ticket) {
  if (!isStaff(interaction.member, ticket)) throw new TicketFlowError('STAFF_ONLY');
  await withTicketAction(context, ticket, interaction.user.id, 'release-assignee', ['open'], async (fresh, token) => {
    if (!fresh.assignedStaffId) throw new TicketFlowError('ASSIGNEE_REQUIRED');
    const previousAssigneeId = fresh.assignedStaffId;
    const now = new Date();
    const updated = await context.database.collection(TICKETS).updateOne(
      { _id: fresh._id, status: 'open', assignedStaffId: previousAssigneeId, 'actionLock.token': token },
      {
        $set: {
          assignedStaffId: null,
          assignedAt: null,
          releasedAt: now,
          releasedBy: interaction.user.id,
          lastReleasedStaffId: previousAssigneeId,
        },
      },
    );
    if (updated.modifiedCount !== 1) throw new TicketFlowError('TICKET_ACTION_BUSY');
    const released = await context.database.collection(TICKETS).findOne({ _id: fresh._id });
    await logTicketAction(context, released, interaction, 'released', `Atendente anterior: <@${previousAssigneeId}>`);
    const thread = await getTicketThread(released, context.guild);
    await thread.send({
      content: `O atendimento com **${actorName(interaction.member)}** foi liberado para outro membro da equipe.`,
      allowedMentions: ALLOWED_MENTIONS,
    }).catch((error) => {
      console.error(`[Tickets] Falha ao anunciar a liberação do atendimento (${error?.name ?? 'Erro'}).`);
    });
    await updateTicketControl(context, released).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar controle após liberar atendimento (${error?.name ?? 'Erro'}).`);
    });
  });
  await answerTicketAction(interaction, 'Responsabilidade liberada.');
}

async function addTicketParticipants(interaction, context, ticket, selectedIds) {
  if (!isStaff(interaction.member, ticket)) throw new TicketFlowError('STAFF_ONLY');
  await withTicketAction(context, ticket, interaction.user.id, 'add-members', ['open'], async (fresh, token) => {
    const uniqueIds = [...new Set(selectedIds)];
    if (uniqueIds.some((id) => id === fresh.ownerId || id === context.client.user.id)) {
      throw new TicketFlowError('INVALID_MEMBER');
    }
    const newIds = uniqueIds.filter((id) => !fresh.participantIds.includes(id));
    if (!newIds.length) throw new TicketFlowError('INVALID_MEMBER');
    const members = await Promise.all(newIds.map((id) => context.guild.members.fetch(id).catch(() => null)));
    if (members.some((member) => !member || member.user.bot)) throw new TicketFlowError('INVALID_MEMBER');
    const host = await fetchChannel(context.guild, fresh.threadChannelId);
    if (!host || host.type !== ChannelType.GuildText) throw new TicketFlowError('THREAD_CHANNEL_INVALID');
    if (members.some((member) => {
      const permissions = host.permissionsFor(member);
      return !permissions?.has(PermissionFlagsBits.ViewChannel)
        || !permissions.has(PermissionFlagsBits.SendMessagesInThreads);
    })) throw new TicketFlowError('INVALID_MEMBER');
    const thread = await getTicketThread(fresh, context.guild);
    const memberResults = await Promise.all(members.map(async (member) => {
      try {
        await thread.members.add(member.id);
        return member.id;
      } catch {
        return null;
      }
    }));
    const addedIds = memberResults.filter(Boolean);
    if (!addedIds.length) throw new TicketFlowError('INVALID_MEMBER');
    const updated = await context.database.collection(TICKETS).updateOne(
      { _id: fresh._id, status: 'open', 'actionLock.token': token },
      { $addToSet: { participantIds: { $each: addedIds } } },
    );
    if (updated.modifiedCount !== 1) throw new TicketFlowError('TICKET_ACTION_BUSY');
    const changed = await context.database.collection(TICKETS).findOne({ _id: fresh._id });
    await logTicketAction(context, changed, interaction, 'member_added', addedIds.map((id) => `<@${id}>`).join(', '));
    await updateTicketControl(context, changed).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar controle após adicionar membro (${error?.name ?? 'Erro'}).`);
    });
    if (addedIds.length !== newIds.length) throw new TicketFlowError('TICKET_PARTIAL_ADD');
  });
  await answerTicketAction(interaction, 'Membro(s) adicionado(s) ao ticket.');
}

async function removeTicketParticipants(interaction, context, ticket, selectedIds) {
  if (!isStaff(interaction.member, ticket)) throw new TicketFlowError('STAFF_ONLY');
  await withTicketAction(context, ticket, interaction.user.id, 'remove-members', ['open'], async (fresh, token) => {
    const uniqueIds = [...new Set(selectedIds)];
    if (uniqueIds.some((id) => id === fresh.ownerId || id === context.client.user.id)) {
      throw new TicketFlowError('INVALID_MEMBER');
    }
    if (uniqueIds.some((id) => id === fresh.assignedStaffId)) {
      throw new TicketFlowError('ASSIGNEE_CANNOT_REMOVE');
    }
    if (uniqueIds.some((id) => !fresh.participantIds.includes(id))) {
      throw new TicketFlowError('PARTICIPANT_NOT_FOUND');
    }
    const thread = await getTicketThread(fresh, context.guild);
    const removed = [];
    let partialFailure = false;
    for (const userId of uniqueIds) {
      try {
        await thread.members.remove(userId);
        removed.push(userId);
      } catch (error) {
        if (Number(error?.code) === 10007) {
          removed.push(userId);
          continue;
        }
        if (!removed.length) throw error;
        partialFailure = true;
        break;
      }
    }
    if (!removed.length) throw new TicketFlowError('PARTICIPANT_NOT_FOUND');
    const updated = await context.database.collection(TICKETS).updateOne(
      { _id: fresh._id, status: 'open', 'actionLock.token': token, participantIds: { $all: removed } },
      { $pull: { participantIds: { $in: removed } } },
    );
    if (updated.modifiedCount !== 1) throw new TicketFlowError('TICKET_ACTION_BUSY');
    const changed = await context.database.collection(TICKETS).findOne({ _id: fresh._id });
    await logTicketAction(context, changed, interaction, 'member_removed', removed.map((id) => `<@${id}>`).join(', '));
    await updateTicketControl(context, changed).catch((error) => {
      console.error(`[Tickets] Falha ao atualizar controle após remover membro (${error?.name ?? 'Erro'}).`);
    });
    if (partialFailure) throw new TicketFlowError('TICKET_PARTIAL_REMOVE');
  });
  await answerTicketAction(interaction, 'Membro(s) removido(s) do ticket.');
}

async function requestTicketResolution(interaction, ticket) {
  const { requester, staff } = await authorizedStaffOrRequester(interaction, ticket);
  if (!requester && !staff) throw new TicketFlowError('REQUESTER_ONLY');
  if (ticket.status === 'ended') throw new TicketFlowError('TICKET_ENDED');
  if (ticket.finalization?.state === 'pending') throw new TicketFlowError('TICKET_FINALIZING');
  await replyV2(
    interaction,
    `Marcar o ticket **#${String(ticket.ticketId).padStart(4, '0')}** como resolvido encerrará o atendimento e enviará o transcript HTML. Esta ação é definitiva.`,
    { ephemeral: true, rows: ticketResolveConfirmationRows(ticket.ticketId) },
  );
}

async function confirmTicketResolution(interaction, context, ticket) {
  const { requester, staff } = await authorizedStaffOrRequester(interaction, ticket);
  if (!requester && !staff) throw new TicketFlowError('REQUESTER_ONLY');
  await interaction.deferReply({ ephemeral: true });
  const result = await finalizeTicket(context, ticket.ticketId, interaction.user.id);
  await interaction.editReply({
    content: `Ticket #${String(ticket.ticketId).padStart(4, '0')} encerrado. Transcript enviado para <#${result.ticket.transcriptChannelId}>.`,
    allowedMentions: ALLOWED_MENTIONS,
  });
}

async function showTicketUserSelect(interaction, context, ticketId, action) {
  const ticket = await context.database.collection(TICKETS).findOne({ _id: String(ticketId) });
  if (!ticket) throw new TicketFlowError('TICKET_NOT_FOUND');
  if (ticket.setupState !== 'complete') throw new TicketFlowError('TICKET_ACTION_BUSY');
  if (ticket.threadId !== interaction.channelId || !isPrivateThread(interaction.channel)) {
    throw new TicketFlowError('TICKET_WRONG_CHANNEL');
  }
  if (ticket.status !== 'open') throw new TicketFlowError('TICKET_NOT_OPEN');
  if (ticket.finalization?.state === 'pending') throw new TicketFlowError('TICKET_FINALIZING');
  if (!isStaff(interaction.member, ticket)) throw new TicketFlowError('STAFF_ONLY');
  if (action === 'transfer' && !ticket.assignedStaffId) throw new TicketFlowError('ASSIGNEE_REQUIRED');
  const prompt = action === 'add'
    ? 'Escolha até 10 membros do servidor para adicionar a este tópico privado.'
    : action === 'remove'
      ? 'Escolha participantes adicionais para remover. O solicitante e o atendente responsável não podem ser removidos por aqui.'
      : 'Escolha um membro da equipe para assumir a responsabilidade. O atendente atual será substituído explicitamente.';
  await replyV2(interaction, prompt, {
    ephemeral: true,
    rows: [ticketUserSelectRow(ticket.ticketId, action)],
  });
}

async function handleTicketControlButton(interaction, context) {
  const match = /^ticket:control:(\d+):(close|reopen|assume|release|add|remove|transfer|resolve)$/.exec(interaction.customId);
  if (!match) return false;
  if (['close', 'reopen', 'assume'].includes(match[2])) {
    await interaction.deferReply({ ephemeral: true });
  }
  const ticket = await getTicketFromControl(interaction, context, match[1]);
  const action = match[2];
  if (ticket.status === 'ended') throw new TicketFlowError('TICKET_ENDED');
  if (ticket.finalization?.state === 'pending') throw new TicketFlowError('TICKET_FINALIZING');
  if (action === 'close') await closeTicket(interaction, context, ticket);
  else if (action === 'reopen') await reopenTicket(interaction, context, ticket);
  else if (action === 'assume') await assumeTicket(interaction, context, ticket);
  else if (action === 'release') await releaseTicketAssignee(interaction, context, ticket);
  else if (action === 'resolve') await requestTicketResolution(interaction, ticket);
  else await showTicketUserSelect(interaction, context, ticket.ticketId, action);
  return true;
}

async function handleTicketUserSelect(interaction, context) {
  const match = /^ticket:select:(\d+):(add|remove|transfer)$/.exec(interaction.customId);
  if (!match || !interaction.isUserSelectMenu()) return false;
  await interaction.deferUpdate();
  const ticket = await context.database.collection(TICKETS).findOne({ _id: String(match[1]) });
  if (!ticket) throw new TicketFlowError('TICKET_NOT_FOUND');
  if (ticket.setupState !== 'complete') throw new TicketFlowError('TICKET_ACTION_BUSY');
  if (ticket.threadId !== interaction.channelId || !isPrivateThread(interaction.channel)) {
    throw new TicketFlowError('TICKET_WRONG_CHANNEL');
  }
  const selectedIds = interaction.values;
  if (match[2] === 'add') await addTicketParticipants(interaction, context, ticket, selectedIds);
  else if (match[2] === 'remove') await removeTicketParticipants(interaction, context, ticket, selectedIds);
  else if (selectedIds.length !== 1) throw new TicketFlowError('INVALID_MEMBER');
  else await transferTicket(interaction, context, ticket, selectedIds[0]);
  return true;
}

async function handleResolutionConfirmation(interaction, context) {
  const confirmation = /^ticket:confirm-resolve:(\d+)$/.exec(interaction.customId);
  if (confirmation && interaction.isButton()) {
    const ticket = await context.database.collection(TICKETS).findOne({ _id: String(confirmation[1]) });
    if (!ticket) throw new TicketFlowError('TICKET_NOT_FOUND');
    if (ticket.setupState !== 'complete') throw new TicketFlowError('TICKET_ACTION_BUSY');
    if (ticket.threadId !== interaction.channelId || !isPrivateThread(interaction.channel)) {
      throw new TicketFlowError('TICKET_WRONG_CHANNEL');
    }
    await confirmTicketResolution(interaction, context, ticket);
    return true;
  }
  const cancel = /^ticket:cancel-resolve:(\d+)$/.exec(interaction.customId);
  if (cancel && interaction.isButton()) {
    await replyV2(interaction, 'Resolução cancelada.', { ephemeral: true });
    return true;
  }
  return false;
}

export async function handleTicketInteraction(interaction, context) {
  if (!interaction.customId) return false;
  context = { ...context, guild: interaction.guild };
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:reason:')) {
    await createOpeningRequest(interaction, context);
    return true;
  }
  try {
    if (await handlePublishedPanelSelection(interaction, context)) return true;
    if (interaction.isButton() && interaction.customId.startsWith('ticket:control:')) {
      return handleTicketControlButton(interaction, context);
    }
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('ticket:select:')) {
      return handleTicketUserSelect(interaction, context);
    }
    if ((interaction.isButton()) && (interaction.customId.startsWith('ticket:confirm-resolve:')
      || interaction.customId.startsWith('ticket:cancel-resolve:'))) {
      return handleResolutionConfirmation(interaction, context);
    }
  } catch (error) {
    if (!(error instanceof TicketFlowError)) {
      console.error(`[Tickets] Falha ao processar interação (${error?.name ?? 'Erro'}).`);
    }
    if (interaction.deferred && interaction.isButton() && !interaction.replied) {
      await interaction.editReply({ content: errorMessage(error), allowedMentions: ALLOWED_MENTIONS });
    } else {
      await replyV2(interaction, errorMessage(error), { ephemeral: true });
    }
    return true;
  }
  return false;
}

async function recoverProvisioningTicket(context, ticket) {
  const tickets = context.database.collection(TICKETS);
  try {
    const host = await fetchChannel(context.guild, ticket.threadChannelId);
    if (!host || host.type !== ChannelType.GuildText) throw new TicketFlowError('THREAD_CHANNEL_INVALID');
    const botMember = await context.guild.members.fetchMe();
    assertHostBotPermissions(host, botMember);
    let thread = ticket.threadId ? await fetchChannel(context.guild, ticket.threadId) : null;
    if (!isPrivateThread(thread)) {
      const activeThreads = await host.threads.fetchActive().catch(() => null);
      const expectedName = safeThreadName(ticket.prefix || 'ticket', ticket.ownerName, ticket.ticketId);
      thread = activeThreads?.threads?.find((candidate) => candidate.name === expectedName) ?? null;
    }
    if (!isPrivateThread(thread)) {
      thread = await host.threads.create({
        name: safeThreadName(ticket.prefix || 'ticket', ticket.ownerName, ticket.ticketId),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: threadAutoArchiveDuration(context.guild),
        reason: `Recuperação do ticket #${ticket.ticketId}`,
      });
      await tickets.updateOne({ _id: ticket._id }, { $set: { threadId: thread.id } });
      ticket.threadId = thread.id;
    }
    const requester = await context.guild.members.fetch(ticket.ownerId);
    assertMemberHostPermissions(host, requester);
    await thread.members.add(requester.id);
    const staffMembers = await listStaffMembers(context.guild, host, ticket.staffRoleIds ?? [], requester.id);
    await addThreadMembers(thread, staffMembers);

    if (ticket.initialMessage && !ticket.initialMessageSent) {
      const nonce = eventNonce(`ticket-initial:${ticket._id}`);
      let initial = await findRecentNonceMessage(thread, nonce);
      if (!initial) {
        initial = await thread.send({
          content: ticket.initialMessage,
          allowedMentions: ALLOWED_MENTIONS,
          nonce,
          enforceNonce: true,
        });
      }
      await tickets.updateOne({ _id: ticket._id }, { $set: { initialMessageSent: true, initialMessageId: initial.id } });
    }
    const current = await tickets.findOne({ _id: ticket._id });
    const nonce = eventNonce(`ticket-control:${ticket._id}`);
    let control = current.controlMessageId
      ? await thread.messages.fetch(current.controlMessageId).catch((error) => (isUnknownMessage(error) ? null : Promise.reject(error)))
      : null;
    if (!control) control = await findRecentNonceMessage(thread, nonce);
    if (!control) {
      control = await thread.send({
        ...ticketControlMessagePayload({ ...current, status: 'open' }, context.guild),
        nonce,
        enforceNonce: true,
      });
    }
    await control.pin();
    await tickets.updateOne(
      { _id: ticket._id, status: 'open', setupState: 'provisioning' },
      { $set: { setupState: 'complete', threadId: thread.id, controlMessageId: control.id, openedAt: new Date() } },
    );
    const opened = await tickets.findOne({ _id: ticket._id });
    await context.database.collection(REQUESTS).updateOne(
      { _id: ticket.requestId },
      { $set: { status: 'complete', ticketId: ticket._id } },
    );
    await recordTicketEvent(context, opened, {
      eventId: ticket.requestId,
      type: 'opened',
      actorId: ticket.ownerId,
      details: `Painel: ${ticket.panelName} · opção: ${ticket.optionLabel}`,
    });
  } catch (error) {
    console.error(`[Tickets] Não foi possível recuperar a preparação do ticket ${ticket.ticketId} (${error?.name ?? 'Erro'}).`);
  }
}

async function recoverPendingFinalizations(context) {
  const now = new Date();
  const pending = await context.database.collection(TICKETS).find({
    status: { $in: ['open', 'closed'] },
    setupState: 'complete',
    'finalization.state': 'pending',
    $or: [
      { 'actionLock.expiresAt': { $exists: false } },
      { 'actionLock.expiresAt': { $lte: now } },
    ],
  }).limit(10).toArray();
  for (const ticket of pending) {
    await finalizeTicket(context, ticket.ticketId, ticket.finalization?.requestedBy ?? null, { recovery: true });
  }
}

async function retryPendingTicketEvents(context) {
  const pending = await context.database.collection(EVENTS)
    .find({ logState: 'pending' })
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray();
  for (const event of pending) {
    await deliverTicketEvent(context, event);
  }
}

async function recoverFinalizedThreads(context) {
  const tickets = await context.database.collection(TICKETS)
    .find({ status: 'ended', threadFinalActionAt: { $exists: false } })
    .sort({ endedAt: 1 })
    .limit(25)
    .toArray();
  for (const ticket of tickets) {
    const thread = await fetchChannel(context.guild, ticket.threadId);
    if (!isPrivateThread(thread)) {
      await context.database.collection(TICKETS).updateOne(
        { _id: ticket._id, status: 'ended', threadFinalActionAt: { $exists: false } },
        { $set: { threadFinalActionAt: new Date(), threadDeletedAt: ticket.threadDeletedAt ?? new Date() } },
      );
      continue;
    }
    await bestEffortFinalizedThreadAction(context, ticket, thread);
  }
}

export async function recoverTicketSystem(context) {
  await reconcileMemberTicketSlots(context.database);
  const provisioning = await context.database.collection(TICKETS)
    .find({ setupState: 'provisioning' })
    .sort({ createdAt: 1 })
    .limit(25)
    .toArray();
  for (const ticket of provisioning) {
    await recoverProvisioningTicket(context, ticket);
  }
  await recoverPendingFinalizations(context);
  await recoverFinalizedThreads(context);
  await retryPendingTicketEvents(context);

  const activeTickets = await context.database.collection(TICKETS)
    .find({
      status: { $in: ['open', 'closed'] },
      setupState: 'complete',
      controlMessageId: { $exists: true },
      threadDeletedAt: { $exists: false },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  for (const ticket of activeTickets) {
    await updateTicketControl(context, ticket).catch((error) => {
      if (error?.code !== 10008) {
        console.error(`[Tickets] Falha ao reconciliar painel do ticket ${ticket.ticketId} (${error?.name ?? 'Erro'}).`);
      }
    });
  }
}

export async function recoverTicketJobs(context) {
  const provisioning = await context.database.collection(TICKETS)
    .find({ setupState: 'provisioning' })
    .sort({ createdAt: 1 })
    .limit(25)
    .toArray();
  for (const ticket of provisioning) {
    await recoverProvisioningTicket(context, ticket);
  }
  await recoverPendingFinalizations(context);
  await recoverFinalizedThreads(context);
  await retryPendingTicketEvents(context);
}

export async function handleTicketThreadDelete(thread, context) {
  const tickets = context.database.collection(TICKETS);
  const ticket = await tickets.findOne({ threadId: thread.id });
  if (!ticket || ticket.status === 'ended') return;
  if (ticket.setupState === 'provisioning') {
    await tickets.deleteOne({ _id: ticket._id, setupState: 'provisioning' });
    await releaseMemberTicketSlot(context.database, ticket.ownerId, ticket._id);
    await context.database.collection(REQUESTS).updateOne(
      { _id: ticket.requestId },
      { $set: { status: 'failed', failureCode: 'THREAD_DELETED' } },
    );
    return;
  }
  const now = new Date();
  const updated = await tickets.updateOne(
    { _id: ticket._id, status: { $in: ['open', 'closed'] } },
    {
      $set: {
        status: 'closed',
        closedAt: now,
        closedBy: null,
        threadDeletedAt: now,
        slotReleased: true,
      },
      $unset: { actionLock: '' },
    },
  );
  if (updated.modifiedCount !== 1) return;
  await releaseMemberTicketSlot(context.database, ticket.ownerId, ticket._id);
  const deleted = await tickets.findOne({ _id: ticket._id });
  await recordTicketEvent(context, deleted, {
    eventId: `thread-deleted:${thread.id}`,
    type: 'thread_deleted',
    actorId: null,
    details: 'O tópico foi removido manualmente. Os dados do ticket foram preservados no MongoDB.',
  });
}

export async function handleTicketStaffRoleUpdate(oldMember, newMember, context) {
  if (oldMember.guild.id !== context.guildId || newMember.guild.id !== context.guildId) return;
  const previous = new Set(getRoleIdsFromMember(oldMember));
  const current = new Set(getRoleIdsFromMember(newMember));
  const added = [...current].filter((roleId) => !previous.has(roleId));
  const removed = [...previous].filter((roleId) => !current.has(roleId));
  if (!added.length && !removed.length) return;
  const retainsAdministrativeAccess = newMember.permissions?.has?.(PermissionFlagsBits.ManageGuild) ?? false;

  const openTickets = await context.database.collection(TICKETS)
    .find({
      status: { $in: ['open', 'closed'] },
      setupState: 'complete',
      ownerId: { $ne: newMember.id },
      staffRoleIds: { $in: [...new Set([...added, ...removed])] },
    })
    .limit(100)
    .toArray();
  for (const ticket of openTickets) {
    const hasTeamRole = hasRole(newMember, ticket.staffRoleIds ?? []);
    const gainedTeamRole = (ticket.staffRoleIds ?? []).some((roleId) => added.includes(roleId));
    const lostTeamRole = (ticket.staffRoleIds ?? []).some((roleId) => removed.includes(roleId));
    const isExplicitParticipant = ticket.participantIds?.includes(newMember.id);
    const isAssignee = ticket.assignedStaffId === newMember.id;
    try {
      const thread = await getTicketThread(ticket, context.guild);
      if (ticket.status === 'open' && hasTeamRole && gainedTeamRole) {
        const host = await fetchChannel(context.guild, ticket.threadChannelId);
        if (!host) continue;
        const permissions = host.permissionsFor(newMember);
        if (!permissions?.has(PermissionFlagsBits.ViewChannel)
          || !permissions.has(PermissionFlagsBits.SendMessagesInThreads)) {
          await recordTicketEvent(context, ticket, {
            eventId: randomUUID(),
            type: 'member_add_failed',
            actorId: null,
            details: `O membro <@${newMember.id}> recebeu um cargo de atendimento, mas não tem acesso ao canal de tópicos.`,
          });
          continue;
        }
        await thread.members.add(newMember.id);
        await recordTicketEvent(context, ticket, {
          eventId: randomUUID(),
          type: 'member_added',
          actorId: null,
          details: `Acesso de equipe concedido automaticamente a <@${newMember.id}>.`,
        });
      } else if (lostTeamRole && !hasTeamRole && !retainsAdministrativeAccess) {
        if (isAssignee) {
          const now = new Date();
          const released = await context.database.collection(TICKETS).updateOne(
            {
              _id: ticket._id,
              status: { $in: ['open', 'closed'] },
              assignedStaffId: newMember.id,
            },
            {
              $set: {
                assignedStaffId: null,
                assignedAt: null,
                releasedAt: now,
                releasedBy: null,
                lastReleasedStaffId: newMember.id,
              },
            },
          );
          if (released.modifiedCount === 1) {
            const refreshed = await context.database.collection(TICKETS).findOne({ _id: ticket._id });
            await recordTicketEvent(context, refreshed, {
              eventId: `staff-role-revoked:${ticket._id}:${newMember.id}:${randomUUID()}`,
              type: 'released',
              actorId: null,
              details: `O cargo de atendimento foi removido de <@${newMember.id}>; a responsabilidade foi liberada.`,
            });
            await updateTicketControl(context, refreshed).catch(() => {});
          }
        }
        const latest = await context.database.collection(TICKETS).findOne({ _id: ticket._id });
        if (!isExplicitParticipant && latest?.assignedStaffId !== newMember.id) {
          await thread.members.remove(newMember.id).catch(() => {});
        }
      }
    } catch (error) {
      if (hasTeamRole && gainedTeamRole) {
        await recordTicketEvent(context, ticket, {
          eventId: randomUUID(),
          type: 'member_add_failed',
          actorId: null,
          details: `O Jinx não conseguiu adicionar <@${newMember.id}> ao tópico privado.`,
        }).catch(() => {});
      }
      console.error(`[Tickets] Falha ao sincronizar cargo de atendimento no ticket ${ticket.ticketId} (${error?.name ?? 'Erro'}).`);
    }
  }
}
