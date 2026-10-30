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
import { DEFAULT_ECONOMY_SETTINGS, DEFAULT_WELCOME_SETTINGS } from '../../config/defaults.js';
import { WELCOME_PLACEHOLDERS } from '../welcome/placeholders.js';
import { formatYen } from '../economy/service.js';

export const PANEL_CATEGORIES = Object.freeze([
  { id: 'levels', label: 'Níveis e economia', description: 'XP, boosts, Yen e apostas' },
  { id: 'voice_calls', label: 'Calls temporárias', description: 'Calls criadas ao entrar em um canal' },
  { id: 'tickets', label: 'Tickets e atendimento', description: 'Painéis, tópicos privados, logs e transcripts' },
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

const LEVEL_ECONOMY_SECTIONS = Object.freeze([
  { id: 'levels', label: 'Níveis', description: 'XP, progressão e boosts' },
  { id: 'economy', label: 'Economia', description: 'Yen, recompensas e apostas' },
]);

const ECONOMY_PAGES = Object.freeze([
  { id: 'overview', label: 'Visão geral', description: 'Resumo da economia' },
  { id: 'daily', label: 'Daily', description: 'Recompensa e sequência diária' },
  { id: 'work', label: 'Trabalho', description: 'Recompensas e cooldown' },
  { id: 'crime', label: 'Crime fictício', description: 'Chance, recompensa e multa' },
  { id: 'transfers', label: 'Transferências', description: 'Limites de pagamentos' },
  { id: 'games', label: 'Apostas', description: 'Limites, prazos e jogos' },
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

function renderEconomyContent(settings, page) {
  if (page === 'daily') {
    return [
      '## Economia — recompensa diária',
      '',
      `Saldo inicial: **${formatYen(settings.startingBalance)}**`,
      `Daily: **${formatYen(settings.daily.reward)}** a cada **${settings.daily.cooldownHours} h**`,
      `Sequência: **${settings.daily.streak.enabled ? 'ativada' : 'desativada'}**`,
      `Bônus progressivo: **${formatYen(settings.daily.streak.bonusPerDay)} por dia**, até **${formatYen(settings.daily.streak.maxBonus)}** ou ${settings.daily.streak.maxDays} dias.`,
      '',
      'O bônus cresce por dias consecutivos e para no limite configurado.',
    ].join('\n');
  }
  if (page === 'work') {
    return [
      '## Economia — trabalho',
      '',
      `Recompensa aleatória: **${formatYen(settings.work.minReward)}–${formatYen(settings.work.maxReward)}**`,
      `Cooldown: **${settings.work.cooldownSeconds} s**`,
      '',
      'As mensagens de trabalho variam para evitar repetição frequente.',
    ].join('\n');
  }
  if (page === 'crime') {
    return [
      '## Economia — crime fictício',
      '',
      `Chance de sucesso: **${settings.crime.successChancePercent}%**`,
      `Recompensa: **${formatYen(settings.crime.minReward)}–${formatYen(settings.crime.maxReward)}**`,
      `Multa em caso de falha: **${formatYen(settings.crime.minFine)}–${formatYen(settings.crime.maxFine)}**, limitada ao saldo disponível.`,
      `Cooldown: **${settings.crime.cooldownSeconds} s**`,
      '',
      'Toda a atividade é fictícia e usa somente Yen virtual.',
    ].join('\n');
  }
  if (page === 'transfers') {
    return [
      '## Economia — transferências',
      '',
      `Valor mínimo: **${formatYen(settings.transfer.minAmount)}**`,
      `Valor máximo por transferência: **${formatYen(settings.transfer.maxAmount)}**`,
      '',
      'As carteiras são debitadas e creditadas com proteção contra saldo insuficiente e operações duplicadas.',
    ].join('\n');
  }
  if (page === 'games') {
    const payoutRows = Object.entries(settings.games.slots.payouts)
      .filter(([, multiplier]) => multiplier > 0)
      .map(([combination, multiplier]) => `• ${combination}: retorno bruto **${multiplier}×**`);
    return [
      '## Economia — apostas',
      '',
      `Aposta mínima/máxima: **${formatYen(settings.games.minBet)} / ${formatYen(settings.games.maxBet)}**`,
      `Pagamento máximo: **${formatYen(settings.games.maxPayout)}**`,
      `Partidas interativas expiram após **${settings.games.timeoutSeconds} s**; a aposta é devolvida.`,
      `Jogos ativos: ${['blackjack', 'roulette', 'slots', 'coin', 'dice'].filter((game) => settings.games[game].enabled).map((game) => ({ blackjack: 'blackjack', roulette: 'roleta', slots: 'slots', coin: 'cara ou coroa', dice: 'dados' })[game]).join(', ') || 'nenhum'}.`,
      '',
      '**Caça-níquel — retorno bruto**',
      ...payoutRows,
      '',
      'Símbolos por posição: 🍒 40%, 🍋 25%, 🍇 15%, 🔔 10%, ⭐ 7%, 💎 3%.',
      'Roleta europeia: número 35:1, cor/paridade/faixa 1:1 e dúzia 2:1 (lucro; a aposta também retorna).',
    ].join('\n');
  }
  return [
    '## Níveis e Economia — economia',
    '',
    `Sistema: **${settings.enabled ? 'ativado' : 'desativado'}**`,
    `Saldo inicial: **${formatYen(settings.startingBalance)}**`,
    `Daily: **${formatYen(settings.daily.reward)}** a cada ${settings.daily.cooldownHours} h; sequência ${settings.daily.streak.enabled ? 'ativa' : 'inativa'}.`,
    `Trabalho: **${formatYen(settings.work.minReward)}–${formatYen(settings.work.maxReward)}** a cada ${settings.work.cooldownSeconds} s.`,
    `Crime fictício: **${settings.crime.successChancePercent}%** de sucesso; recompensa ${formatYen(settings.crime.minReward)}–${formatYen(settings.crime.maxReward)}.`,
    `Transferências: **${formatYen(settings.transfer.minAmount)}–${formatYen(settings.transfer.maxAmount)}**.`,
    `Apostas: **${formatYen(settings.games.minBet)}–${formatYen(settings.games.maxBet)}**, limite de retorno ${formatYen(settings.games.maxPayout)}.`,
    '',
    'Use os controles para configurar recompensas, cooldowns, limites e jogos. Yen é moeda fictícia, sem conversão em dinheiro real.',
  ].join('\n');
}

export function renderPanelContent(
  category,
  settings,
  guild,
  welcomeSection = 'overview',
  economySettings,
  levelsSection = 'levels',
  economyPage = 'overview',
) {
  if (category === 'home') {
    return [
      '## Painel de administração — Jinx',
      '',
      'Escolha uma categoria no menu para abrir suas opções.',
      '',
      '**Disponível:** níveis e boosts de XP, economia em Yen, boas-vindas, calls temporárias, tickets e comandos utilitários.',
      '**Em preparação:** sugestões e destaque de perfis.',
    ].join('\n');
  }

  if (category === 'levels') {
    if (levelsSection === 'economy') {
      return renderEconomyContent(economySettings, economyPage);
    }
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
      'Use o seletor de seção para alternar entre níveis e economia. As configurações de XP permanecem independentes.',
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

  if (category === 'tickets') {
    return [
      '## Tickets e atendimento',
      '',
      'Configure painéis públicos ou mensagens privadas. Opções de abertura criam um tópico privado, solicitam o motivo em formulário e fixam o painel de controle do ticket.',
      '',
      'Use as subseções para ajustar canais e equipe ou administrar painéis e opções.',
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

function levelsEconomySectionRow(section) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('panel:levels:section')
    .setPlaceholder('Escolha entre níveis e economia')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(LEVEL_ECONOMY_SECTIONS.map((item) => ({
      label: item.label,
      value: item.id,
      description: item.description,
      default: item.id === section,
    })));
  return new ActionRowBuilder().addComponents(select);
}

function economyPageRow(page) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('panel:economy:page')
    .setPlaceholder('Escolha uma configuração de economia')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(ECONOMY_PAGES.map((item) => ({
      label: item.label,
      value: item.id,
      description: item.description,
      default: item.id === page,
    })));
  return new ActionRowBuilder().addComponents(select);
}

function economyRows(page, settings) {
  const rows = [levelsEconomySectionRow('economy'), economyPageRow(page)];
  if (page === 'overview') {
    rows.push(new ActionRowBuilder().addComponents(
      button('panel:economy:enabled', settings.enabled ? 'Desativar economia' : 'Ativar economia', ButtonStyle.Primary),
      button('panel:economy:edit:starting', 'Editar saldo inicial'),
    ));
  } else if (page === 'daily') {
    rows.push(new ActionRowBuilder().addComponents(
      button('panel:economy:streak', settings.daily.streak.enabled ? 'Desativar sequência' : 'Ativar sequência', ButtonStyle.Primary),
      button('panel:economy:edit:daily', 'Editar daily e sequência'),
    ));
  } else if (page === 'work') {
    rows.push(new ActionRowBuilder().addComponents(button('panel:economy:edit:work', 'Editar trabalho', ButtonStyle.Primary)));
  } else if (page === 'crime') {
    rows.push(new ActionRowBuilder().addComponents(
      button('panel:economy:edit:crime-rewards', 'Chance e recompensas', ButtonStyle.Primary),
      button('panel:economy:edit:crime-fines', 'Multas e cooldown'),
    ));
  } else if (page === 'transfers') {
    rows.push(new ActionRowBuilder().addComponents(button('panel:economy:edit:transfers', 'Editar limites', ButtonStyle.Primary)));
  } else if (page === 'games') {
    rows.push(new ActionRowBuilder().addComponents(
      button('panel:economy:game:blackjack', 'Blackjack', settings.games.blackjack.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('panel:economy:game:roulette', 'Roleta', settings.games.roulette.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('panel:economy:game:slots', 'Slots', settings.games.slots.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('panel:economy:game:coin', 'Cara ou coroa', settings.games.coin.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('panel:economy:game:dice', 'Dados', settings.games.dice.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button('panel:economy:edit:game-limits', 'Limites e expiração', ButtonStyle.Primary),
      button('panel:economy:edit:slot-payouts', 'Pagamentos de slots'),
      button('panel:economy:edit:slot-diamond', 'Pagamento do 💎'),
    ));
  }
  return rows;
}

export function buildPanelRows(
  category = 'home',
  welcomeSection = 'overview',
  welcomeSettings,
  levelsSection = 'levels',
  economyPage = 'overview',
  economySettings = DEFAULT_ECONOMY_SETTINGS,
) {
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

  const section = LEVEL_ECONOMY_SECTIONS.some((item) => item.id === levelsSection)
    ? levelsSection
    : 'levels';
  if (section === 'economy') {
    const selectedPage = ECONOMY_PAGES.some((item) => item.id === economyPage)
      ? economyPage
      : 'overview';
    return [...rows, ...economyRows(selectedPage, economySettings)];
  }
  rows.push(levelsEconomySectionRow('levels'));

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

const ECONOMY_FIELD_LABELS = Object.freeze({
  startingBalance: 'Saldo inicial',
  dailyReward: 'Recompensa diária',
  dailyCooldownHours: 'Cooldown daily em horas',
  streakBonusPerDay: 'Bônus por dia consecutivo',
  streakMaxBonus: 'Bônus máximo da sequência',
  streakMaxDays: 'Dias da sequência',
  workMinReward: 'Recompensa mínima',
  workMaxReward: 'Recompensa máxima',
  workCooldownSeconds: 'Cooldown em segundos',
  crimeChance: 'Chance de sucesso (%)',
  crimeMinReward: 'Recompensa mínima',
  crimeMaxReward: 'Recompensa máxima',
  crimeMinFine: 'Multa mínima',
  crimeMaxFine: 'Multa máxima',
  crimeCooldownSeconds: 'Cooldown em segundos',
  transferMinAmount: 'Valor mínimo',
  transferMaxAmount: 'Valor máximo',
  gameMinBet: 'Aposta mínima',
  gameMaxBet: 'Aposta máxima',
  gameMaxPayout: 'Pagamento máximo',
  gameTimeoutSeconds: 'Expiração em segundos',
  slotsCherries: 'Retorno bruto 🍒🍒🍒',
  slotsLemons: 'Retorno bruto 🍋🍋🍋',
  slotsGrapes: 'Retorno bruto 🍇🍇🍇',
  slotsBells: 'Retorno bruto 🔔🔔🔔',
  slotsStars: 'Retorno bruto ⭐⭐⭐',
  slotsDiamond: 'Retorno bruto 💎💎💎',
});

export function buildEconomyModal(type, settings) {
  const values = {
    startingBalance: settings.startingBalance,
    dailyReward: settings.daily.reward,
    dailyCooldownHours: settings.daily.cooldownHours,
    streakBonusPerDay: settings.daily.streak.bonusPerDay,
    streakMaxBonus: settings.daily.streak.maxBonus,
    streakMaxDays: settings.daily.streak.maxDays,
    workMinReward: settings.work.minReward,
    workMaxReward: settings.work.maxReward,
    workCooldownSeconds: settings.work.cooldownSeconds,
    crimeChance: settings.crime.successChancePercent,
    crimeMinReward: settings.crime.minReward,
    crimeMaxReward: settings.crime.maxReward,
    crimeMinFine: settings.crime.minFine,
    crimeMaxFine: settings.crime.maxFine,
    crimeCooldownSeconds: settings.crime.cooldownSeconds,
    transferMinAmount: settings.transfer.minAmount,
    transferMaxAmount: settings.transfer.maxAmount,
    gameMinBet: settings.games.minBet,
    gameMaxBet: settings.games.maxBet,
    gameMaxPayout: settings.games.maxPayout,
    gameTimeoutSeconds: settings.games.timeoutSeconds,
    slotsCherries: settings.games.slots.payouts['🍒🍒🍒'],
    slotsLemons: settings.games.slots.payouts['🍋🍋🍋'],
    slotsGrapes: settings.games.slots.payouts['🍇🍇🍇'],
    slotsBells: settings.games.slots.payouts['🔔🔔🔔'],
    slotsStars: settings.games.slots.payouts['⭐⭐⭐'],
    slotsDiamond: settings.games.slots.payouts['💎💎💎'],
  };
  const groups = {
    starting: ['startingBalance'],
    daily: ['dailyReward', 'dailyCooldownHours', 'streakBonusPerDay', 'streakMaxBonus', 'streakMaxDays'],
    work: ['workMinReward', 'workMaxReward', 'workCooldownSeconds'],
    'crime-rewards': ['crimeChance', 'crimeMinReward', 'crimeMaxReward'],
    'crime-fines': ['crimeMinFine', 'crimeMaxFine', 'crimeCooldownSeconds'],
    transfers: ['transferMinAmount', 'transferMaxAmount'],
    'game-limits': ['gameMinBet', 'gameMaxBet', 'gameMaxPayout', 'gameTimeoutSeconds'],
    'slot-payouts': ['slotsCherries', 'slotsLemons', 'slotsGrapes', 'slotsBells', 'slotsStars'],
    'slot-diamond': ['slotsDiamond'],
  };
  const fields = groups[type];
  if (!fields) {
    throw new Error('ECONOMY_MODAL_UNKNOWN');
  }
  const titles = {
    starting: 'Saldo inicial',
    daily: 'Daily e sequência',
    work: 'Recompensas de trabalho',
    'crime-rewards': 'Chance e recompensas',
    'crime-fines': 'Multas e cooldown',
    transfers: 'Limites de transferência',
    'game-limits': 'Limites das apostas',
    'slot-payouts': 'Pagamentos dos slots',
    'slot-diamond': 'Pagamento do diamante',
  };
  return new ModalBuilder()
    .setCustomId(`panel:economy:modal:${type}`)
    .setTitle(titles[type])
    .addComponents(...fields.map((id) => numberInput(id, ECONOMY_FIELD_LABELS[id], values[id])));
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
