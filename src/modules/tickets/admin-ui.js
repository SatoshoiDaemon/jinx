import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { BOT_CONFIG_COLLECTION, BOT_CONFIG_ID, DEFAULT_TICKET_SETTINGS } from '../../config/defaults.js';
import { buildPanelRows, renderPanelContent } from '../panel/components.js';
import { v2EditPayload } from '../common/components-v2.js';

function button(customId, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

function navRow(buttons) {
  return new ActionRowBuilder().addComponents(...buttons);
}

function panelSelectRow(panels, selectedId, page) {
  const start = page * 25;
  const visible = panels.slice(start, start + 25);
  if (visible.length === 0) {
    return null;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`panel:tickets:panels:select:${page}`)
    .setPlaceholder('Selecione um painel de atendimento')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(visible.map((panel) => ({
      label: panel.name.slice(0, 100),
      description: `${panel.active ? 'Ativo' : 'Desativado'} · ${panel.options?.length ?? 0} opção(ões)`.slice(0, 100),
      value: panel._id,
      default: panel._id === selectedId,
    })));
  return new ActionRowBuilder().addComponents(select);
}

function optionSelectRow(panel, selectedOptionId) {
  if (!panel?.options?.length) {
    return null;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`panel:tickets:options:select:${panel._id}`)
    .setPlaceholder('Selecione uma opção')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(panel.options.slice(0, 25).map((option) => ({
      label: option.label.slice(0, 100),
      description: `${option.active === false ? 'Desativada' : 'Ativa'} · ${option.action === 'reply' ? 'Resposta privada' : 'Abrir ticket'}`.slice(0, 100),
      value: option.id,
      default: option.id === selectedOptionId,
    })));
  return new ActionRowBuilder().addComponents(select);
}

function selectedPanel(panels, selectedId, page = 0) {
  return panels.find((panel) => panel._id === selectedId)
    ?? panels.slice(page * 25, page * 25 + 25)[0]
    ?? panels[0]
    ?? null;
}

function selectedOption(panel, selectedOptionId) {
  return panel?.options?.find((option) => option.id === selectedOptionId)
    ?? panel?.options?.[0]
    ?? null;
}

function renderOverview(settings, panelCount) {
  return [
    '## Tickets e atendimento',
    '',
    `Sistema: **${settings.enabled ? 'ativado' : 'desativado'}**`,
    `Painéis configurados: **${panelCount}**`,
    `Canal de tópicos: ${settings.defaultThreadChannelId ? `<#${settings.defaultThreadChannelId}>` : 'não configurado'}`,
    `Equipe padrão: ${settings.staffRoleIds.length ? settings.staffRoleIds.map((id) => `<@&${id}>`).join(', ') : 'nenhum cargo configurado'}`,
    `Logs operacionais: ${settings.logsChannelId ? `<#${settings.logsChannelId}>` : 'não configurado'}`,
    `Transcripts: ${settings.transcriptsChannelId ? `<#${settings.transcriptsChannelId}>` : 'não configurado'}`,
    '',
    'Tickets são tópicos privados. Para dar acesso à equipe, o Jinx adiciona ao tópico os membros atuais dos cargos configurados; cargos não concedem acesso automaticamente.',
  ].join('\n');
}

function renderChannels(settings, guild) {
  const channelName = (id) => {
    if (!id) return 'não configurado';
    const channel = guild.channels.cache.get(id);
    return channel ? `<#${channel.id}>` : `canal indisponível (${id})`;
  };
  return [
    '## Tickets — canais',
    '',
    `Canal padrão para tópicos privados: ${channelName(settings.defaultThreadChannelId)}`,
    `Canal de logs operacionais: ${channelName(settings.logsChannelId)}`,
    `Canal de transcripts HTML: ${channelName(settings.transcriptsChannelId)}`,
    '',
    'Escolha cada canal pelos seletores. O canal de tópicos precisa ser um canal de texto com suporte a threads privadas.',
  ].join('\n');
}

function renderStaff(settings, guild) {
  const visibleRoleIds = settings.staffRoleIds.slice(0, 10);
  const roleList = settings.staffRoleIds.length
    ? [
      ...visibleRoleIds.map((id) => {
      const role = guild.roles.cache.get(id);
      return role ? `• <@&${role.id}> — ${role.name.slice(0, 60)}` : `• Cargo removido — ${id}`;
      }),
      ...(settings.staffRoleIds.length > visibleRoleIds.length
        ? [`• e mais ${settings.staffRoleIds.length - visibleRoleIds.length} cargos`]
        : []),
    ].join('\n')
    : 'Nenhum cargo configurado.';
  return [
    '## Tickets — equipe e regras',
    '',
    '**Cargos padrão de atendimento**',
    roleList,
    '',
    `Limite simultâneo por membro: **${settings.maxTicketsPerMember}**`,
    `Solicitante pode reabrir: **${settings.requesterCanReopen ? 'sim' : 'não'}**`,
    `Após resolver: **${settings.resolvedThreadBehavior === 'delete' ? 'excluir o tópico' : 'arquivar o tópico'}**`,
    '',
    `Mensagem inicial padrão: ${(settings.defaultInitialMessage || 'nenhuma').slice(0, 800)}`,
  ].join('\n');
}

function renderPanels(panels, panel, page) {
  if (!panel) {
    return [
      '## Tickets — painéis de atendimento',
      '',
      'Nenhum painel configurado. Crie um painel para preparar opções de atendimento ou respostas privadas.',
    ].join('\n');
  }
  return [
    '## Tickets — painéis de atendimento',
    '',
    `Página ${page + 1} de ${Math.max(1, Math.ceil(panels.length / 25))} · **${panel.name}** (${panel.active ? 'ativo' : 'desativado'})`,
    `Título: **${panel.title}**`,
    `Publicação: ${panel.channelId ? `<#${panel.channelId}>` : 'canal não selecionado'} · ${panel.messageId ? 'mensagem publicada' : 'ainda não publicada'}`,
    `Interação: **${panel.interactionType === 'select' ? 'Select Menu' : 'botões'}**`,
    `Opções: **${panel.options?.filter((option) => option.active !== false).length ?? 0} ativas** de ${panel.options?.length ?? 0}`,
    '',
    'Edite o conteúdo, escolha o canal e publique. Painéis publicados são atualizados na mesma mensagem quando ela ainda existe.',
  ].join('\n');
}

function renderOptions(panel, option) {
  if (!panel) {
    return '## Tickets — opções\n\nCrie ou selecione um painel primeiro.';
  }
  if (!option) {
    return [
      `## Opções — ${panel.name}`,
      '',
      'Este painel ainda não tem opções. Crie uma opção para abrir ticket ou enviar uma resposta privada.',
    ].join('\n');
  }
  return [
    `## Opções — ${panel.name}`,
    '',
    `Opção: **${option.label}** (${option.active === false ? 'desativada' : 'ativa'})`,
    `Ação: **${option.action === 'reply' ? 'responder privadamente' : 'abrir ticket'}**`,
    `Descrição: ${option.description || 'não configurada'}`,
    `Canal do tópico: ${option.threadChannelId ? `<#${option.threadChannelId}>` : 'usar padrão'}`,
    `Equipe: ${option.staffRoleIds?.length ? option.staffRoleIds.map((id) => `<@&${id}>`).join(', ') : 'usar cargos padrão'}`,
    ...(option.action === 'reply' ? [`Resposta privada: ${option.responseText || 'não configurada'}`] : [
      `Prefixo do tópico: ${option.prefix || 'ticket'}`,
      `Limite por membro: ${option.maxTicketsPerMember ?? 'usar padrão'}`,
      `Mensagem inicial: ${option.initialMessage || 'usar mensagem padrão'}`,
    ]),
  ].join('\n');
}

export function buildTicketAdminView({ settings, panels, guild, page = 'overview', subpage = 'channels', panelId, optionId, panelPage = 0 }) {
  const pageCount = Math.max(1, Math.ceil(panels.length / 25));
  const requestedPage = Math.max(0, Math.min(panelPage, pageCount - 1));
  const panel = selectedPanel(panels, panelId, requestedPage);
  const option = selectedOption(panel, optionId);
  const rows = [];

  if (page === 'overview') {
    rows.push(navRow([
      button('panel:tickets:home', 'Voltar ao painel'),
      button('panel:tickets:settings:channels', 'Configurações'),
      button('panel:tickets:panels:0', 'Painéis de atendimento', ButtonStyle.Primary),
      button('panel:tickets:toggle', settings.enabled ? 'Desativar tickets' : 'Ativar tickets', ButtonStyle.Success),
    ]));
    return { content: renderOverview(settings, panels.length), rows };
  }

  if (page === 'settings') {
    rows.push(navRow([
      button('panel:tickets:home', 'Início'),
      button('panel:tickets:settings:channels', 'Canais', subpage === 'channels' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      button('panel:tickets:settings:staff', 'Equipe e regras', subpage === 'staff' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      button('panel:tickets:panels:0', 'Painéis'),
    ]));
    if (subpage === 'staff') {
      rows.push(new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('panel:tickets:default:staff')
          .setPlaceholder('Selecione os cargos padrão de atendimento')
          .setMinValues(0)
          .setMaxValues(25),
      ));
      rows.push(navRow([
        button('panel:tickets:settings:edit', 'Editar limites e mensagem inicial', ButtonStyle.Primary),
      ]));
      return { content: renderStaff(settings, guild), rows };
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('panel:tickets:default:thread')
        .setPlaceholder('Canal padrão para tópicos privados')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('panel:tickets:default:logs')
        .setPlaceholder('Canal de logs operacionais')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('panel:tickets:default:transcripts')
        .setPlaceholder('Canal de transcripts HTML')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ));
    rows.push(navRow([
      button('panel:tickets:default:clear-thread', 'Limpar canal de tópicos', ButtonStyle.Secondary),
      button('panel:tickets:default:clear-logs', 'Limpar canal de logs', ButtonStyle.Secondary),
      button('panel:tickets:default:clear-transcripts', 'Limpar canal de transcripts', ButtonStyle.Secondary),
    ]));
    return { content: renderChannels(settings, guild), rows };
  }

  if (page === 'options') {
    if (!panel) {
      return {
        content: renderOptions(null, null),
        rows: [navRow([button(`panel:tickets:panels:${panelPage}`, 'Voltar aos painéis')])],
      };
    }
    rows.push(navRow([
      button(`panel:tickets:panels:${panelPage}:${panel._id}`, 'Voltar ao painel selecionado'),
      button(`pt:o:default:${panel._id}:${option?.id ?? '-'}`, 'Usar canal padrão', ButtonStyle.Secondary, !option),
    ]));
    const selectRow = optionSelectRow(panel, option?.id);
    if (selectRow) rows.push(selectRow);
    rows.push(navRow([
      button(`panel:tickets:options:new:${panel._id}`, 'Criar opção', ButtonStyle.Success),
      button(`pt:o:edit:${panel._id}:${option?.id ?? '-'}`, 'Editar opção', ButtonStyle.Primary, !option),
      button(`pt:o:settings:${panel._id}:${option?.id ?? '-'}`, 'Configurar ticket', ButtonStyle.Secondary, !option || option.action !== 'ticket'),
      button(`pt:o:toggle:${panel._id}:${option?.id ?? '-'}`, option?.active === false ? 'Ativar opção' : 'Desativar opção', ButtonStyle.Secondary, !option),
      button(`pt:o:delete:${panel._id}:${option?.id ?? '-'}`, 'Excluir opção', ButtonStyle.Danger, !option),
    ]));
    if (option?.action === 'ticket') {
      rows.push(new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`pt:o:channel:${panel._id}:${option.id}`)
          .setPlaceholder('Canal para este tipo de ticket (opcional)')
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1),
      ));
      rows.push(new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`pt:o:roles:${panel._id}:${option.id}`)
          .setPlaceholder('Cargos de atendimento para esta opção')
          .setMinValues(0)
          .setMaxValues(25),
      ));
    }
    return { content: renderOptions(panel, option), rows };
  }

  const pageNumber = requestedPage;
  const shownPanel = panel;
  const shownPanelPage = shownPanel ? Math.floor(panels.findIndex((item) => item._id === shownPanel._id) / 25) : pageNumber;
  rows.push(navRow([
    button('panel:tickets:home', 'Início'),
    button('panel:tickets:settings:channels', 'Configurações'),
    button(`panel:tickets:panels:${Math.max(0, shownPanelPage - 1)}:${shownPanel?._id ?? '-'}`, 'Anterior', ButtonStyle.Secondary, shownPanelPage === 0),
    button(`panel:tickets:panels:${Math.min(Math.ceil(panels.length / 25) - 1, shownPanelPage + 1)}:-`, 'Próxima', ButtonStyle.Secondary, shownPanelPage >= Math.ceil(panels.length / 25) - 1),
  ]));
  const panelRow = panelSelectRow(panels, shownPanel?._id, shownPanelPage);
  if (panelRow) rows.push(panelRow);
  if (shownPanel) {
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`panel:tickets:panel-channel:${shownPanel._id}`)
        .setPlaceholder('Canal onde este painel será publicado')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ));
  }
  rows.push(navRow([
    button(`panel:tickets:panels:new:${shownPanelPage}`, 'Criar painel', ButtonStyle.Success),
    button(`panel:tickets:panels:edit:${shownPanel?._id ?? '-'}`, 'Editar painel', ButtonStyle.Primary, !shownPanel),
    button(`panel:tickets:options:${shownPanel?._id ?? '-'}`, 'Opções', ButtonStyle.Secondary, !shownPanel),
    button(`panel:tickets:panels:interaction:${shownPanel?._id ?? '-'}`, shownPanel?.interactionType === 'select' ? 'Usar botões' : 'Usar Select Menu', ButtonStyle.Secondary, !shownPanel),
  ]));
  rows.push(navRow([
    button(`panel:tickets:panels:publish:${shownPanel?._id ?? '-'}`, shownPanel?.messageId ? 'Atualizar publicação' : 'Publicar', ButtonStyle.Primary, !shownPanel),
    button(`panel:tickets:panels:toggle:${shownPanel?._id ?? '-'}`, shownPanel?.active ? 'Desativar' : 'Ativar', ButtonStyle.Success, !shownPanel),
    button(`panel:tickets:panels:delete:${shownPanel?._id ?? '-'}`, 'Excluir', ButtonStyle.Danger, !shownPanel),
  ]));
  return { content: renderPanels(panels, shownPanel, shownPanelPage), rows };
}

export async function showTicketAdmin(interaction, context, {
  page = 'overview',
  subpage = 'channels',
  panelId,
  optionId,
  panelPage = 0,
  alreadyDeferred = false,
} = {}) {
  if (!alreadyDeferred) {
    await interaction.deferUpdate();
  }
  const [settings, panels] = await Promise.all([
    context.database.collection(BOT_CONFIG_COLLECTION).findOne(
      { _id: BOT_CONFIG_ID },
      { projection: { 'modules.tickets': 1 } },
    ).then((document) => ({ ...DEFAULT_TICKET_SETTINGS, ...(document?.modules?.tickets ?? {}) })),
    context.database.collection('ticket_panels').find({}).sort({ createdAt: 1 }).toArray(),
  ]);
  const view = buildTicketAdminView({
    settings,
    panels,
    guild: interaction.guild,
    page,
    subpage,
    panelId,
    optionId,
    panelPage,
  });
  await interaction.editReply(v2EditPayload(view.content, { rows: view.rows }));
}

export async function showPanelHome(interaction) {
  await interaction.editReply(v2EditPayload(renderPanelContent('home'), { rows: buildPanelRows() }));
}
