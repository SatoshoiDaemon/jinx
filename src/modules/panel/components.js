import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { DEFAULT_WELCOME_SETTINGS } from '../../config/defaults.js';
import { WELCOME_PLACEHOLDERS } from '../welcome/placeholders.js';

export const PANEL_CATEGORIES = Object.freeze([
  { id: 'levels', label: 'Níveis e economia', description: 'XP, progressão e boosts' },
  { id: 'voice_calls', label: 'Calls temporárias', description: 'Calls criadas ao entrar em um canal' },
  { id: 'tickets', label: 'Tickets e atendimento', description: 'Indisponível no momento' },
  { id: 'welcome', label: 'Boas-vindas', description: 'Cargos iniciais e mensagens de entrada' },
  { id: 'suggestions', label: 'Sugestões', description: 'Indisponível no momento' },
  { id: 'profile', label: 'Destaque de perfis', description: 'Indisponível no momento' },
  { id: 'core', label: 'Núcleo do bot — utilitários e configurações gerais', description: 'Utilitários; opções de ajuste indisponíveis' },
]);

const WELCOME_SECTIONS = Object.freeze([
  { id: 'overview', label: 'Visão geral', description: 'Estado das três funcionalidades' },
  { id: 'roles', label: 'Cargos iniciais', description: 'Atribuição automática de cargos' },
  { id: 'dm', label: 'Mensagem privada', description: 'DM enviada ao novo membro' },
  { id: 'public', label: 'Mensagem pública', description: 'Mensagem temporária em um canal' },
  { id: 'placeholders', label: 'Placeholders', description: 'Variáveis disponíveis nas mensagens' },
]);

function enabledText(enabled) {
  return enabled ? 'Ativada' : 'Desativada';
}

function configuredRolesText(settings, guild) {
  if (settings.initialRoles.roleIds.length === 0) {
    return 'Nenhum cargo selecionado.';
  }

  return settings.initialRoles.roleIds.map((roleId) => {
    const role = guild?.roles.cache.get(roleId);
    return role
      ? `• ${role.name} — \`${role.id}\``
      : `• Cargo indisponível — \`${roleId}\``;
  }).join('\n');
}

function configuredChannelText(settings, guild) {
  const channelId = settings.publicMessage.channelId;
  if (!channelId) {
    return 'Nenhum canal selecionado.';
  }
  const channel = guild?.channels.cache.get(channelId);
  return channel
    ? `#${channel.name} — \`${channel.id}\``
    : `Canal indisponível — \`${channelId}\``;
}

function renderWelcomeContent(settings, guild, section) {
  if (section === 'roles') {
    return [
      '## Boas-vindas — cargos iniciais',
      '',
      `**Estado:** ${enabledText(settings.initialRoles.enabled)}`,
      '**Cargos configurados:**',
      configuredRolesText(settings, guild),
      '',
      'Selecione um ou mais cargos para substituir a lista atual. O Jinx ignora cargos removidos, gerenciados ou acima do cargo mais alto do bot.',
    ].join('\n');
  }

  if (section === 'dm') {
    return [
      '## Boas-vindas — mensagem privada',
      '',
      `**Estado:** ${enabledText(settings.directMessage.enabled)}`,
      '**Mensagem configurada:**',
      settings.directMessage.content || DEFAULT_WELCOME_SETTINGS.directMessage.content,
      '',
      'A prévia é enviada por DM para você. Se um membro bloquear DMs, as demais ações continuam normalmente.',
    ].join('\n');
  }

  if (section === 'public') {
    return [
      '## Boas-vindas — mensagem pública',
      '',
      `**Estado:** ${enabledText(settings.publicMessage.enabled)}`,
      `**Canal:** ${configuredChannelText(settings, guild)}`,
      '**Mensagem configurada:**',
      settings.publicMessage.content || DEFAULT_WELCOME_SETTINGS.publicMessage.content,
      '',
      'A mensagem é removida 5 segundos após o envio. O teste também cria uma mensagem temporária.',
    ].join('\n');
  }

  if (section === 'placeholders') {
    return [
      '## Boas-vindas — placeholders',
      '',
      'Use estas variáveis nas mensagens privadas e públicas. Datas são exibidas em português, no horário UTC.',
      ...WELCOME_PLACEHOLDERS.map(({ placeholder, description }) => `• \`${placeholder}\` — ${description}`),
      '',
      'Placeholders desconhecidos permanecem no texto. Menções são limitadas ao membro correspondente; `@everyone` e `@here` não notificam o servidor.',
    ].join('\n');
  }

  return [
    '## Boas-vindas',
    '',
    'Configure cada ação de entrada de forma independente. As alterações são salvas no MongoDB e entram em vigor imediatamente.',
    '',
    `**Cargos iniciais:** ${enabledText(settings.initialRoles.enabled)} (${settings.initialRoles.roleIds.length} selecionado(s))`,
    `**Mensagem privada:** ${enabledText(settings.directMessage.enabled)}`,
    `**Mensagem pública:** ${enabledText(settings.publicMessage.enabled)}`,
    `**Canal público:** ${configuredChannelText(settings, guild)}`,
    '',
    'Escolha uma seção no menu para ver suas configurações e controles.',
  ].join('\n');
}

export function renderPanelContent(category, settings, guild, welcomeSection = 'overview') {
  if (category === 'home') {
    return [
      '## Painel de administração — Jinx',
      '',
      'Escolha uma categoria no menu para abrir suas opções.',
      '',
      '**Disponível:** níveis e boosts de XP, boas-vindas, calls temporárias e comandos utilitários.',
      '**Em preparação:** economia, tickets, sugestões e destaque de perfis.',
    ].join('\n');
  }

  if (category === 'levels') {
    return [
      '## Níveis e economia',
      '',
      '**Níveis e XP**',
      `XP por mensagem: **${settings.xpMin}–${settings.xpMax}**`,
      `Cooldown: **${settings.cooldownSeconds} s**`,
      `Curva: **${settings.xpBase} + nível × ${settings.xpStep}** XP`,
      `Boost máximo por cargo/canal: **${settings.maxBoostMultiplier}×**`,
      `Boosts ativos: **${Object.keys(settings.roleBoosts ?? {}).length} cargos** e **${Object.keys(settings.channelBoosts ?? {}).length} canais**.`,
      '',
      'Use os controles abaixo para ajustar níveis e boosts. A economia ainda não está disponível.',
    ].join('\n');
  }

  if (category === 'welcome') {
    return renderWelcomeContent(settings, guild, welcomeSection);
  }

  if (category === 'voice_calls') {
    const baseChannel = settings.baseChannelId
      ? guild?.channels.cache.get(settings.baseChannelId)
      : null;
    const targetCategory = settings.categoryId
      ? guild?.channels.cache.get(settings.categoryId)
      : null;
    return [
      `## ${PANEL_CATEGORIES.find((item) => item.id === category).label}`,
      '',
      `Canal base: ${baseChannel ? `<#${baseChannel.id}>` : 'não configurado'}`,
      `Categoria: ${targetCategory ? `<#${targetCategory.id}>` : 'não configurada'}`,
      '',
      'Quando alguém entrar no canal base, o bot cria uma call com o nome da pessoa, move-a para lá e deixa a call aberta para todos. Quando a call fica vazia, ela é removida.',
      '',
      'Selecione um canal de voz e uma categoria nos controles abaixo. O bot precisa de **Gerenciar canais** e **Mover membros**.',
    ].join('\n');
  }

  const selected = PANEL_CATEGORIES.find((item) => item.id === category);
  if (!selected) {
    return 'Esta categoria não está disponível.';
  }

  if (category === 'core') {
    return [
      `## ${selected.label}`,
      '',
      'Os utilitários disponíveis podem ser usados pelos comandos do bot. Ainda não há configurações gerais para editar por aqui.',
    ].join('\n');
  }

  return [
    `## ${selected.label}`,
    '',
    'Este sistema ainda não está disponível. As opções aparecerão aqui quando a implementação estiver pronta.',
  ].join('\n');
}

function categorySelectRow() {
  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId('panel:category')
    .setPlaceholder('Escolha uma categoria')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(PANEL_CATEGORIES.map((item) => ({
      label: item.label,
      value: item.id,
      description: item.description,
    })));
  return new ActionRowBuilder().addComponents(categorySelect);
}

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function welcomeRows(section, settings) {
  const sectionSelect = new StringSelectMenuBuilder()
    .setCustomId('panel:welcome:section')
    .setPlaceholder('Escolha uma seção de boas-vindas')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(WELCOME_SECTIONS.map((item) => ({
      label: item.label,
      value: item.id,
      description: item.description,
      default: item.id === section,
    })));
  const rows = [new ActionRowBuilder().addComponents(sectionSelect)];

  if (section === 'roles') {
    rows.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('panel:welcome:roles:select')
        .setPlaceholder('Selecione cargos para substituir a lista atual')
        .setMinValues(1)
        .setMaxValues(25),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button(
        'panel:welcome:initialRoles:toggle',
        settings?.initialRoles.enabled ? 'Desativar cargos' : 'Ativar cargos',
        ButtonStyle.Primary,
      ),
      button('panel:welcome:roles:clear', 'Remover todos os cargos', ButtonStyle.Danger),
    ));
  }

  if (section === 'dm') {
    rows.push(new ActionRowBuilder().addComponents(
      button(
        'panel:welcome:directMessage:toggle',
        settings?.directMessage.enabled ? 'Desativar DM' : 'Ativar DM',
        ButtonStyle.Primary,
      ),
      button('panel:welcome:dm:edit', 'Editar mensagem'),
      button('panel:welcome:dm:preview', 'Enviar prévia'),
      button('panel:welcome:dm:reset', 'Restaurar padrão', ButtonStyle.Secondary),
    ));
  }

  if (section === 'public') {
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('panel:welcome:public:channel')
        .setPlaceholder('Selecione o canal de boas-vindas')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button(
        'panel:welcome:publicMessage:toggle',
        settings?.publicMessage.enabled ? 'Desativar mensagem' : 'Ativar mensagem',
        ButtonStyle.Primary,
      ),
      button('panel:welcome:public:edit', 'Editar mensagem'),
      button('panel:welcome:public:test', 'Testar mensagem'),
      button('panel:welcome:public:reset', 'Restaurar padrão'),
      button('panel:welcome:public:channel:clear', 'Remover canal', ButtonStyle.Danger),
    ));
  }

  return rows;
}

export function buildPanelRows(category = 'home', welcomeSection = 'overview', welcomeSettings) {
  const rows = [categorySelectRow()];

  if (category === 'welcome') {
    const section = WELCOME_SECTIONS.some((item) => item.id === welcomeSection)
      ? welcomeSection
      : 'overview';
    return [...rows, ...welcomeRows(section, welcomeSettings)];
  }

  if (category === 'voice_calls') {
    const baseChannelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('panel:voice:base')
      .setPlaceholder('Escolha o canal base de voz')
      .setChannelTypes(ChannelType.GuildVoice)
      .setMinValues(1)
      .setMaxValues(1);
    const targetCategorySelect = new ChannelSelectMenuBuilder()
      .setCustomId('panel:voice:category')
      .setPlaceholder('Escolha a categoria das calls')
      .setChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1);
    rows.push(
      new ActionRowBuilder().addComponents(baseChannelSelect),
      new ActionRowBuilder().addComponents(targetCategorySelect),
      new ActionRowBuilder().addComponents(
        button('panel:voice:clear-base', 'Limpar canal base'),
        button('panel:voice:clear-category', 'Limpar categoria'),
      ),
    );
    return rows;
  }

  if (category !== 'levels') {
    return rows;
  }

  const settingsButton = button('panel:settings', 'Ajustar níveis e XP', ButtonStyle.Primary);
  const boostLimitButton = button('panel:boost-limit', 'Limite de boosts');
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('panel:role')
    .setPlaceholder('Escolha um cargo para configurar o boost')
    .setMinValues(1)
    .setMaxValues(1);
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('panel:channel')
    .setPlaceholder('Escolha um canal para configurar o boost')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);

  rows.push(
    new ActionRowBuilder().addComponents(settingsButton, boostLimitButton),
    new ActionRowBuilder().addComponents(roleSelect),
    new ActionRowBuilder().addComponents(channelSelect),
  );
  return rows;
}

function numberInput(customId, label, value, { required = true, placeholder = String(value) } = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(placeholder)
    .setRequired(required)
    .setMaxLength(16);

  if (required) {
    input.setValue(String(value));
  }
  return new ActionRowBuilder().addComponents(input);
}

export function buildSettingsModal() {
  return new ModalBuilder()
    .setCustomId('panel:modal:settings')
    .setTitle('Configurações de níveis e XP')
    .addComponents(
      numberInput('xpBase', 'XP base para o próximo nível', '', { required: false, placeholder: 'Em branco mantém atual' }),
      numberInput('xpStep', 'Aumento por nível', '', { required: false, placeholder: 'Em branco mantém atual' }),
      numberInput('xpMin', 'XP mínimo por mensagem', '', { required: false, placeholder: 'Em branco mantém atual' }),
      numberInput('xpMax', 'XP máximo por mensagem', '', { required: false, placeholder: 'Em branco mantém atual' }),
      numberInput('cooldownSeconds', 'Cooldown em segundos', '', { required: false, placeholder: 'Em branco mantém atual' }),
    );
}

export function buildBoostLimitModal() {
  return new ModalBuilder()
    .setCustomId('panel:modal:boost-limit')
    .setTitle('Limite de boosts')
    .addComponents(
      numberInput('maxBoostMultiplier', 'Multiplicador máximo por boost', '', {
        required: false,
        placeholder: 'Em branco mantém atual',
      }),
    );
}

export function buildBoostModal(kind, targetId) {
  const label = kind === 'role' ? 'cargo' : 'canal';
  const input = new TextInputBuilder()
    .setCustomId('multiplier')
    .setLabel(`Multiplicador do ${label}`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Informe um número; 0 remove o boost')
    .setRequired(true)
    .setMaxLength(16);

  return new ModalBuilder()
    .setCustomId(`panel:modal:${kind}:${targetId}`)
    .setTitle(`Configurar boost de ${label}`)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export function buildWelcomeMessageModal(kind, content) {
  const isDm = kind === 'dm';
  const message = new TextInputBuilder()
    .setCustomId('content')
    .setLabel(isDm ? 'Mensagem privada' : 'Mensagem pública')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Escreva a mensagem e use os placeholders disponíveis')
    .setRequired(true)
    .setMaxLength(2000)
    .setValue(content.slice(0, 2000));

  return new ModalBuilder()
    .setCustomId(`panel:welcome:${kind}:modal`)
    .setTitle(isDm ? 'Editar mensagem privada' : 'Editar mensagem pública')
    .addComponents(new ActionRowBuilder().addComponents(message));
}
