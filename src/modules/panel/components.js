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

export const PANEL_CATEGORIES = Object.freeze([
  { id: 'levels', label: 'Níveis e economia', description: 'XP, progressão e boosts' },
  { id: 'tickets', label: 'Tickets e atendimento', description: 'Indisponível no momento' },
  { id: 'welcome', label: 'Boas-vindas — mensagens públicas', description: 'Indisponível no momento' },
  { id: 'suggestions', label: 'Sugestões', description: 'Indisponível no momento' },
  { id: 'profile', label: 'Destaque de perfis', description: 'Indisponível no momento' },
  { id: 'member_entry', label: 'Entrada de membros — mensagens privadas e cargos iniciais', description: 'Indisponível no momento' },
  { id: 'core', label: 'Núcleo do bot — utilitários e configurações gerais', description: 'Utilitários; opções de ajuste indisponíveis' },
]);

export function renderPanelContent(category, settings) {
  if (category === 'home') {
    return [
      '## Painel de administração — Jinx',
      '',
      'Escolha uma categoria no menu para abrir suas opções.',
      '',
      '**Disponível:** níveis e boosts de XP; comandos utilitários.',
      '**Em preparação:** economia, tickets, boas-vindas, sugestões, destaque de perfis, entrada de membros e configurações gerais.',
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

export function buildPanelRows(category = 'home') {
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
  const rows = [new ActionRowBuilder().addComponents(categorySelect)];

  if (category !== 'levels') {
    return rows;
  }

  const settingsButton = new ButtonBuilder()
    .setCustomId('panel:settings')
    .setLabel('Ajustar níveis e XP')
    .setStyle(ButtonStyle.Primary);
  const boostLimitButton = new ButtonBuilder()
    .setCustomId('panel:boost-limit')
    .setLabel('Limite de boosts')
    .setStyle(ButtonStyle.Secondary);
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
