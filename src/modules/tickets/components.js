import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  parseEmoji,
} from 'discord.js';

const ALLOWED_MENTIONS = Object.freeze({ parse: [] });
let RGI_EMOJI_PATTERN = null;
try {
  RGI_EMOJI_PATTERN = new RegExp('^\\p{RGI_Emoji}$', 'v');
} catch {
  // Older supported Node builds can lack Unicode string properties.
}

function isUnicodeRgiEmoji(value) {
  if (RGI_EMOJI_PATTERN) return RGI_EMOJI_PATTERN.test(value);

  const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)];
  if (/^[#*0-9]\uFE0F?\u20E3$/u.test(value)) return true;
  return graphemes.length === 1
    && /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(value)
    && !/[\p{Letter}\p{Number}\p{White_Space}]/u.test(value);
}

export function normalizeTicketEmoji(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';

  const emoji = parseEmoji(input);
  if (!emoji?.name) return null;
  if (emoji.id) return /^\d{17,20}$/u.test(emoji.id) ? input : null;
  if (isUnicodeRgiEmoji(emoji.name)) return emoji.name;

  // Some mobile keyboards append U+FE0F even when the base emoji already
  // defaults to emoji presentation. Accept that input when removing the
  // redundant selector yields exactly one recognized Unicode emoji.
  const withoutVariationSelectors = emoji.name.replace(/\uFE0F/gu, '');
  return withoutVariationSelectors !== emoji.name && isUnicodeRgiEmoji(withoutVariationSelectors)
    ? withoutVariationSelectors
    : null;
}

export function isValidTicketEmoji(value) {
  return normalizeTicketEmoji(value) !== null;
}

function textInput(customId, label, value, {
  style = TextInputStyle.Short,
  required = true,
  maxLength = 1000,
  placeholder,
} = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);
  if (placeholder) input.setPlaceholder(placeholder);
  if (value !== undefined && value !== null && String(value).length > 0) {
    input.setValue(String(value).slice(0, maxLength));
  }
  return new ActionRowBuilder().addComponents(input);
}

export function buildTicketPanelModal(panel = null) {
  const modal = new ModalBuilder()
    .setCustomId(panel ? `ptm:panel:${panel._id}` : 'ptm:panel:new')
    .setTitle(panel ? 'Editar painel de atendimento' : 'Criar painel de atendimento')
    .addComponents(
      textInput('name', 'Nome administrativo', panel?.name ?? '', { maxLength: 80 }),
      textInput('title', 'Título publicado', panel?.title ?? '', { maxLength: 180 }),
      textInput('description', 'Descrição publicada', panel?.description ?? '', {
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1200,
      }),
      textInput('message', 'Mensagem do painel', panel?.message ?? '', {
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1400,
      }),
      textInput('images', 'URLs de imagens HTTPS (uma por linha)', (panel?.imageUrls ?? []).join('\n'), {
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1800,
        placeholder: 'https://exemplo.com/imagem.png',
      }),
    );
  return modal;
}

export function buildTicketOptionModal(panelId, option = null) {
  return new ModalBuilder()
    .setCustomId(option
      ? `ptm:option:${panelId}:${option.id}`
      : `ptm:option:${panelId}:new`)
    .setTitle(option ? 'Editar opção de atendimento' : 'Criar opção de atendimento')
    .addComponents(
      textInput('label', 'Rótulo', option?.label ?? '', { maxLength: 80 }),
      textInput('description', 'Descrição', option?.description ?? '', {
        required: false,
        maxLength: 100,
      }),
      textInput('emoji', 'Emoji (opcional)', option?.emoji ?? '', {
        required: false,
        maxLength: 100,
        placeholder: '🎫',
      }),
      textInput('action', 'Ação: ticket ou reply', option?.action ?? 'ticket', {
        maxLength: 10,
        placeholder: 'ticket ou reply',
      }),
      textInput('response', 'Resposta privada (para reply)', option?.responseText ?? '', {
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1800,
      }),
    );
}

export function buildTicketOptionSettingsModal(panelId, option) {
  return new ModalBuilder()
    .setCustomId(`ptm:config:${panelId}:${option.id}`)
    .setTitle('Configurar abertura de ticket')
    .addComponents(
      textInput('prefix', 'Prefixo do tópico', option.prefix ?? 'ticket', { maxLength: 35 }),
      textInput('initialMessage', 'Mensagem inicial', option.initialMessage ?? '', {
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1800,
      }),
      textInput('ticketLimit', 'Tickets simultâneos (vazio = padrão)', option.maxTicketsPerMember ?? '', {
        required: false,
        maxLength: 2,
        placeholder: '1 a 10',
      }),
    );
}

export function buildTicketSettingsModal(settings) {
  return new ModalBuilder()
    .setCustomId('ptm:settings')
    .setTitle('Regras padrão dos tickets')
    .addComponents(
      textInput('maxTickets', 'Tickets simultâneos por membro (1 a 10)', settings.maxTicketsPerMember, {
        maxLength: 2,
      }),
      textInput('requesterReopen', 'Solicitante pode reabrir? sim ou nao', settings.requesterCanReopen ? 'sim' : 'nao', {
        maxLength: 3,
      }),
      textInput('resolvedBehavior', 'Após resolver: arquivar ou excluir', settings.resolvedThreadBehavior, {
        maxLength: 8,
      }),
      textInput('initialMessage', 'Mensagem inicial padrão', settings.defaultInitialMessage, {
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1800,
      }),
    );
}

function button(customId, label, style, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

export function buildPublishedPanelPayload(panel, systemEnabled) {
  const active = panel.active && systemEnabled;
  const text = [
    `# ${panel.title}`,
    panel.description,
    panel.message,
  ].filter(Boolean).join('\n\n');
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text || '## Atendimento'));

  if (panel.imageUrls?.length) {
    const gallery = new MediaGalleryBuilder().addItems(
      ...panel.imageUrls.slice(0, 10).map((url) => new MediaGalleryItemBuilder().setURL(url)),
    );
    container.addMediaGalleryComponents(gallery);
  }

  const options = (panel.options ?? []).filter((option) => option.active !== false);
  if (panel.interactionType === 'select' && options.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`ticket:menu:${panel._id}`)
      .setPlaceholder('Escolha uma opção de atendimento')
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(!active)
      .addOptions(options.map((option) => ({
        label: option.label,
        value: option.id,
        ...(option.description ? { description: option.description } : {}),
        ...(option.emoji ? { emoji: normalizeTicketEmoji(option.emoji) } : {}),
      })));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  } else if (options.length) {
    for (let offset = 0; offset < options.length; offset += 5) {
      const row = new ActionRowBuilder().addComponents(options.slice(offset, offset + 5).map((option) => {
        const item = button(
          `ticket:option:${panel._id}:${option.id}`,
          option.label,
          ButtonStyle.Primary,
          !active,
        );
        if (option.emoji) item.setEmoji(normalizeTicketEmoji(option.emoji));
        return item;
      }));
      container.addActionRowComponents(row);
    }
  }

  if (!active) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('Este painel está desativado no momento.'));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: ALLOWED_MENTIONS,
  };
}

function splitText(value, maxLength) {
  const chunks = [];
  let rest = String(value ?? '');
  while (rest.length > maxLength) {
    let splitAt = maxLength;
    if (rest.charCodeAt(splitAt - 1) >= 0xd800 && rest.charCodeAt(splitAt - 1) <= 0xdbff) {
      splitAt -= 1;
    }
    chunks.push(rest.slice(0, splitAt));
    rest = rest.slice(splitAt);
  }
  if (rest || chunks.length === 0) chunks.push(rest);
  return chunks;
}

export function buildTicketControlEmbed(ticket, guild) {
  const fields = [
    { name: 'Solicitante', value: `<@${ticket.ownerId}>`, inline: true },
    { name: 'Estado', value: ({ open: 'Aberto', closed: 'Fechado', ended: 'Encerrado' })[ticket.status] ?? 'Preparando', inline: true },
    { name: 'Categoria', value: `${ticket.panelName} · ${ticket.optionLabel}`.slice(0, 1024), inline: true },
  ];
  const team = (ticket.staffRoleIds ?? []).map((roleId) => guild.roles.cache.has(roleId)
    ? `<@&${roleId}>`
    : `cargo removido (${roleId})`).join(', ');
  fields.push({ name: 'Equipe responsável', value: (team || 'Nenhuma equipe configurada').slice(0, 1024) });
  fields.push({
    name: 'Atendente responsável',
    value: ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : 'Nenhum',
    inline: true,
  });
  const participants = (ticket.participantIds ?? []).slice(0, 15).map((id) => `<@${id}>`);
  if ((ticket.participantIds?.length ?? 0) > 15) {
    participants.push(`e mais ${ticket.participantIds.length - 15}`);
  }
  fields.push({
    name: 'Membros adicionais autorizados',
    value: participants.join(', ') || 'Nenhum',
  });
  fields.push({
    name: 'Aberto em',
    value: new Date(ticket.createdAt).toLocaleString('pt-BR', { timeZone: 'UTC' }),
    inline: true,
  });
  if (ticket.closedAt) {
    fields.push({
      name: 'Fechado em',
      value: new Date(ticket.closedAt).toLocaleString('pt-BR', { timeZone: 'UTC' }),
      inline: true,
    });
  }
  if (ticket.resolvedAt) {
    fields.push({
      name: 'Resolvido em',
      value: new Date(ticket.resolvedAt).toLocaleString('pt-BR', { timeZone: 'UTC' }),
      inline: true,
    });
  }
  if (ticket.finalization?.state === 'pending') {
    fields.push({ name: 'Finalização', value: 'Gerando e enviando o transcript…' });
  } else if (ticket.finalization?.state === 'failed') {
    fields.push({ name: 'Finalização', value: 'Falhou. A equipe pode tentar novamente pelo botão de resolução.' });
  }
  const reasonChunks = splitText(ticket.reason, 1000);
  reasonChunks.slice(0, 4).forEach((value, index) => fields.push({
    name: reasonChunks.length === 1 ? 'Motivo informado' : `Motivo informado (${index + 1}/${reasonChunks.length})`,
    value: value || '—',
  }));

  return new EmbedBuilder()
    .setColor(ticket.status === 'ended' ? 0x57f287 : ticket.status === 'closed' ? 0x747f8d : 0x5865f2)
    .setTitle(`Ticket #${String(ticket.ticketId).padStart(4, '0')} — ${ticket.optionLabel}`.slice(0, 256))
    .setFields(...fields)
    .setFooter({ text: 'Jinx • painel de controle' })
    .setTimestamp(new Date(ticket.createdAt));
}

export function buildTicketControlRows(ticket) {
  if (ticket.status === 'ended') return [];
  const pending = ticket.finalization?.state === 'pending';
  const id = ticket.ticketId;
  if (ticket.status === 'closed') {
    return [new ActionRowBuilder().addComponents(
      button(`ticket:control:${id}:reopen`, 'Reabrir', ButtonStyle.Success, pending),
      button(`ticket:control:${id}:resolve`, 'Marcar como resolvido', ButtonStyle.Danger, pending),
    )];
  }
  return [
    new ActionRowBuilder().addComponents(
      button(`ticket:control:${id}:close`, 'Fechar ticket', ButtonStyle.Secondary, pending),
      button(`ticket:control:${id}:assume`, 'Assumir', ButtonStyle.Primary, pending),
      button(`ticket:control:${id}:resolve`, 'Marcar como resolvido', ButtonStyle.Danger, pending),
    ),
    new ActionRowBuilder().addComponents(
      button(`ticket:control:${id}:add`, 'Adicionar membros', ButtonStyle.Secondary, pending),
      button(`ticket:control:${id}:remove`, 'Remover participantes', ButtonStyle.Secondary, pending),
      button(`ticket:control:${id}:transfer`, 'Transferir atendente', ButtonStyle.Secondary, pending || !ticket.assignedStaffId),
      button(`ticket:control:${id}:release`, 'Liberar atendente', ButtonStyle.Secondary, pending || !ticket.assignedStaffId),
    ),
  ];
}

export function ticketControlMessagePayload(ticket, guild) {
  return {
    embeds: [buildTicketControlEmbed(ticket, guild)],
    components: buildTicketControlRows(ticket),
    allowedMentions: ALLOWED_MENTIONS,
  };
}

export function ticketPanelConfirmationRows(panelId) {
  return [new ActionRowBuilder().addComponents(
    button(`panel:tickets:panels:confirm-delete:${panelId}`, 'Excluir painel', ButtonStyle.Danger),
    button(`panel:tickets:panels:cancel-delete:${panelId}`, 'Cancelar', ButtonStyle.Secondary),
  )];
}

export function ticketResolveConfirmationRows(ticketId) {
  return [new ActionRowBuilder().addComponents(
    button(`ticket:confirm-resolve:${ticketId}`, 'Confirmar resolução', ButtonStyle.Danger),
    button(`ticket:cancel-resolve:${ticketId}`, 'Cancelar', ButtonStyle.Secondary),
  )];
}

export function ticketUserSelectRow(ticketId, action) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(`ticket:select:${ticketId}:${action}`)
    .setPlaceholder(action === 'add' ? 'Selecione membros para adicionar' : action === 'remove' ? 'Selecione participantes para remover' : 'Selecione o novo atendente')
    .setMinValues(1)
    .setMaxValues(action === 'transfer' ? 1 : 10);
  return new ActionRowBuilder().addComponents(menu);
}
