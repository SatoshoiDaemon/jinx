import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_LEVEL_SETTINGS,
  DEFAULT_VOICE_CALL_SETTINGS,
} from '../../config/defaults.js';
import {
  getModuleConfig,
  removeModuleConfigValue,
  updateModuleConfig,
  updateModuleConfigValue,
} from '../../models/bot-config.js';
import { editReplyV2, replyV2, v2EditPayload } from '../common/components-v2.js';
import { validateLevelSettings } from '../levels/rules.js';
import { getWelcomeSettings } from '../welcome/service.js';
import { getEconomySettings, validateEconomySettings } from '../economy/config.js';
import { handleWelcomePanelInteraction } from '../welcome/panel.js';
import { handleTicketAdminInteraction } from '../tickets/admin.js';
import { showTicketAdmin } from '../tickets/admin-ui.js';
import {
  buildBoostLimitModal,
  buildBoostModal,
  buildEconomyModal,
  buildPanelRows,
  buildSettingsModal,
  PANEL_CATEGORIES,
  renderPanelContent,
} from './components.js';
import { handleRiotPanelInteraction, showRiotPage } from '../riot-updates/panel.js';

function hasPanelPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function parseMultiplier(value) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('INVALID_BOOST');
  }
  const multiplier = Number(normalized);
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error('INVALID_BOOST');
  }
  return multiplier;
}

async function showLevelsSection(
  interaction,
  database,
  levelsSection = 'levels',
  economyPage = 'overview',
  alreadyDeferred = false,
) {
  if (!alreadyDeferred) {
    await interaction.deferUpdate();
  }
  const [levelSettings, economySettings] = await Promise.all([
    getModuleConfig(database, 'levels', DEFAULT_LEVEL_SETTINGS),
    getEconomySettings(database),
  ]);
  await interaction.editReply(v2EditPayload(
    renderPanelContent('levels', levelSettings, interaction.guild, 'overview', economySettings, levelsSection, economyPage),
    { rows: buildPanelRows('levels', 'overview', levelSettings, levelsSection, economyPage, economySettings) },
  ));
}

async function showCategory(interaction, database, category, alreadyDeferred = false) {
  if (!PANEL_CATEGORIES.some((item) => item.id === category)) {
    await replyV2(interaction, 'Esta categoria do painel não está disponível.', { ephemeral: true });
    return;
  }
  if (category === 'levels') {
    await showLevelsSection(interaction, database, 'levels', 'overview', alreadyDeferred);
    return;
  }
  if (category === 'tickets') {
    await showTicketAdmin(interaction, { database, guild: interaction.guild }, { alreadyDeferred });
    return;
  }
  if (category === 'riot_updates') {
    await showRiotPage(interaction, { database, client: interaction.client, guildId: interaction.guildId }, 'patchNotes', alreadyDeferred);
    return;
  }
  if (!alreadyDeferred) {
    await interaction.deferUpdate();
  }
  let settings;
  if (category === 'welcome') {
    settings = await getWelcomeSettings(database);
  } else if (category === 'voice_calls') {
    settings = await getModuleConfig(database, 'voice_calls', DEFAULT_VOICE_CALL_SETTINGS);
  }
  await interaction.editReply(v2EditPayload(
    renderPanelContent(category, settings, interaction.guild),
    { rows: buildPanelRows(category, 'overview', settings) },
  ));
}

const ECONOMY_FIELD_PATHS = Object.freeze({
  startingBalance: 'startingBalance',
  dailyReward: 'daily.reward',
  dailyCooldownHours: 'daily.cooldownHours',
  streakBonusPerDay: 'daily.streak.bonusPerDay',
  streakMaxBonus: 'daily.streak.maxBonus',
  streakMaxDays: 'daily.streak.maxDays',
  workMinReward: 'work.minReward',
  workMaxReward: 'work.maxReward',
  workCooldownSeconds: 'work.cooldownSeconds',
  crimeChance: 'crime.successChancePercent',
  crimeMinReward: 'crime.minReward',
  crimeMaxReward: 'crime.maxReward',
  crimeMinFine: 'crime.minFine',
  crimeMaxFine: 'crime.maxFine',
  crimeCooldownSeconds: 'crime.cooldownSeconds',
  transferMinAmount: 'transfer.minAmount',
  transferMaxAmount: 'transfer.maxAmount',
  gameMinBet: 'games.minBet',
  gameMaxBet: 'games.maxBet',
  gameMaxPayout: 'games.maxPayout',
  gameTimeoutSeconds: 'games.timeoutSeconds',
  slotsCherries: 'games.slots.payouts.🍒🍒🍒',
  slotsLemons: 'games.slots.payouts.🍋🍋🍋',
  slotsGrapes: 'games.slots.payouts.🍇🍇🍇',
  slotsBells: 'games.slots.payouts.🔔🔔🔔',
  slotsStars: 'games.slots.payouts.⭐⭐⭐',
  slotsDiamond: 'games.slots.payouts.💎💎💎',
});

function setNestedValue(target, path, value) {
  const segments = path.split('.');
  const finalKey = segments.pop();
  const parent = segments.reduce((current, key) => current[key], target);
  parent[finalKey] = value;
}

export async function handlePanelInteraction(interaction, context) {
  const ticketAdminInteraction = interaction.customId?.startsWith('panel:tickets:')
    || interaction.customId?.startsWith('pt:o:')
    || interaction.customId?.startsWith('ptm:');
  if (
    (!interaction.customId?.startsWith('panel:') && !ticketAdminInteraction)
    || (!interaction.isButton() && !interaction.isRoleSelectMenu()
      && !interaction.isChannelSelectMenu() && !interaction.isStringSelectMenu()
      && !interaction.isModalSubmit())
  ) {
    return false;
  }

  if (!hasPanelPermission(interaction)) {
    await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor** para usar este painel.', { ephemeral: true });
    return true;
  }

  if (interaction.customId?.startsWith('panel:riot:')) {
    return handleRiotPanelInteraction(interaction, context);
  }

  if (ticketAdminInteraction) {
    return handleTicketAdminInteraction(interaction, context);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:category') {
    await showCategory(interaction, context.database, interaction.values[0]);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:levels:section') {
    const section = interaction.values[0] === 'economy' ? 'economy' : 'levels';
    await showLevelsSection(interaction, context.database, section, 'overview');
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:economy:page') {
    await showLevelsSection(interaction, context.database, 'economy', interaction.values[0]);
    return true;
  }

  if (interaction.customId.startsWith('panel:welcome:')) {
    return handleWelcomePanelInteraction(interaction, context);
  }

  if (interaction.isButton() && interaction.customId === 'panel:economy:enabled') {
    await interaction.deferUpdate();
    const current = await getEconomySettings(context.database);
    await updateModuleConfigValue(context.database, 'economy', 'enabled', !current.enabled);
    await showLevelsSection(interaction, context.database, 'economy', 'overview', true);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:economy:streak') {
    await interaction.deferUpdate();
    const current = await getEconomySettings(context.database);
    await updateModuleConfigValue(context.database, 'economy', 'daily.streak.enabled', !current.daily.streak.enabled);
    await showLevelsSection(interaction, context.database, 'economy', 'daily', true);
    return true;
  }

  const economyGameToggle = interaction.isButton()
    ? /^panel:economy:game:(blackjack|roulette|slots|coin|dice)$/.exec(interaction.customId)
    : null;
  if (economyGameToggle) {
    const [, gameName] = economyGameToggle;
    await interaction.deferUpdate();
    const current = await getEconomySettings(context.database);
    await updateModuleConfigValue(
      context.database,
      'economy',
      `games.${gameName}.enabled`,
      !current.games[gameName].enabled,
    );
    await showLevelsSection(interaction, context.database, 'economy', 'games', true);
    return true;
  }

  const economyEditButton = interaction.isButton()
    ? /^panel:economy:edit:([a-z-]+)$/.exec(interaction.customId)
    : null;
  if (economyEditButton) {
    const current = await getEconomySettings(context.database);
    await interaction.showModal(buildEconomyModal(economyEditButton[1], current));
    return true;
  }

  const economyModal = interaction.isModalSubmit()
    ? /^panel:economy:modal:([a-z-]+)$/.exec(interaction.customId)
    : null;
  if (economyModal) {
    const current = await getEconomySettings(context.database);
    const updated = structuredClone(current);
    try {
      for (const [field, path] of Object.entries(ECONOMY_FIELD_PATHS)) {
        let raw;
        try {
          raw = interaction.fields.getTextInputValue(field);
        } catch {
          continue;
        }
        const normalized = raw.trim();
        if (!/^-?\d+$/.test(normalized)) {
          throw new Error('ECONOMY_CONFIGURATION_INVALID');
        }
        const value = Number(normalized);
        if (!Number.isSafeInteger(value)) {
          throw new Error('ECONOMY_CONFIGURATION_INVALID');
        }
        setNestedValue(updated, path, value);
      }
      const validated = validateEconomySettings(updated);
      await updateModuleConfig(context.database, 'economy', validated);
    } catch (error) {
      if (error.message !== 'ECONOMY_CONFIGURATION_INVALID') {
        throw error;
      }
      await replyV2(
        interaction,
        'Configuração inválida. Use valores inteiros dentro dos limites; recompensas máximas devem ser maiores que as mínimas e os pagamentos caber no limite configurado.',
        { ephemeral: true },
      );
      return true;
    }
    await interaction.deferUpdate();
    const pageByModal = {
      starting: 'overview', daily: 'daily', work: 'work',
      'crime-rewards': 'crime', 'crime-fines': 'crime', transfers: 'transfers',
      'game-limits': 'games', 'slot-payouts': 'games', 'slot-diamond': 'games',
    };
    await showLevelsSection(interaction, context.database, 'economy', pageByModal[economyModal[1]] ?? 'overview', true);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:settings') {
    await interaction.showModal(buildSettingsModal());
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:boost-limit') {
    await interaction.showModal(buildBoostLimitModal());
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:voice:clear-base') {
    await interaction.deferUpdate();
    await removeModuleConfigValue(context.database, 'voice_calls', 'baseChannelId');
    await showCategory(interaction, context.database, 'voice_calls', true);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:voice:clear-category') {
    await interaction.deferUpdate();
    await removeModuleConfigValue(context.database, 'voice_calls', 'categoryId');
    await showCategory(interaction, context.database, 'voice_calls', true);
    return true;
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:role') {
    await interaction.showModal(buildBoostModal('role', interaction.values[0]));
    return true;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'panel:channel') {
    await interaction.showModal(buildBoostModal('channel', interaction.values[0]));
    return true;
  }

  const voiceSettingMatch = interaction.isChannelSelectMenu()
    ? /^panel:voice:(base|category)$/.exec(interaction.customId)
    : null;
  if (voiceSettingMatch) {
    const [, setting] = voiceSettingMatch;
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    const expectedType = setting === 'base' ? ChannelType.GuildVoice : ChannelType.GuildCategory;
    if (!channel || channel.type !== expectedType) {
      await replyV2(interaction, 'O canal selecionado não está mais disponível.', { ephemeral: true });
      return true;
    }

    const settingPath = setting === 'base' ? 'baseChannelId' : 'categoryId';
    await interaction.deferUpdate();
    await updateModuleConfigValue(context.database, 'voice_calls', settingPath, channel.id);
    await showCategory(interaction, context.database, 'voice_calls', true);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'panel:modal:settings') {
    await replyV2(interaction, 'Salvando as configurações…', { ephemeral: true });
    const current = await getModuleConfig(context.database, 'levels', DEFAULT_LEVEL_SETTINGS);
    const fields = interaction.fields;
    let settings;
    try {
      settings = validateLevelSettings({
        xpBase: fields.getTextInputValue('xpBase').trim() || current.xpBase,
        xpStep: fields.getTextInputValue('xpStep').trim() || current.xpStep,
        xpMin: fields.getTextInputValue('xpMin').trim() || current.xpMin,
        xpMax: fields.getTextInputValue('xpMax').trim() || current.xpMax,
        cooldownSeconds: fields.getTextInputValue('cooldownSeconds').trim() || current.cooldownSeconds,
        maxBoostMultiplier: current.maxBoostMultiplier,
      });
    } catch (error) {
      if (error.message !== 'CONFIGURATION_INVALID') {
        throw error;
      }
      await editReplyV2(
        interaction,
        'Confira os valores: XP base e mínimo devem ser positivos, o passo e cooldown não podem ser negativos, e o máximo de XP deve ser pelo menos o mínimo.',
        { ephemeral: true },
      );
      return true;
    }
    await updateModuleConfig(context.database, 'levels', settings);
    await editReplyV2(interaction, 'Configurações de níveis e XP atualizadas.', { ephemeral: true });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'panel:modal:boost-limit') {
    await replyV2(interaction, 'Salvando o limite de boosts…', { ephemeral: true });
    const current = await getModuleConfig(context.database, 'levels', DEFAULT_LEVEL_SETTINGS);
    let settings;
    try {
      settings = validateLevelSettings({
        ...current,
        maxBoostMultiplier: interaction.fields.getTextInputValue('maxBoostMultiplier').trim()
          || current.maxBoostMultiplier,
      });
    } catch (error) {
      if (error.message !== 'CONFIGURATION_INVALID') {
        throw error;
      }
      await editReplyV2(interaction, 'O limite precisa ser um número igual ou maior que 1.', { ephemeral: true });
      return true;
    }
    await updateModuleConfig(context.database, 'levels', settings);
    await editReplyV2(interaction, 'Limite de boosts atualizado.', { ephemeral: true });
    return true;
  }

  const boostMatch = interaction.isModalSubmit()
    ? /^panel:modal:(role|channel):(\d+)$/.exec(interaction.customId)
    : null;
  if (boostMatch) {
    const [, kind, targetId] = boostMatch;
    let multiplier;
    try {
      multiplier = parseMultiplier(interaction.fields.getTextInputValue('multiplier'));
    } catch (error) {
      if (error.message !== 'INVALID_BOOST') {
        throw error;
      }
      await replyV2(interaction, 'Informe 0 para remover ou um multiplicador positivo.', { ephemeral: true });
      return true;
    }
    await replyV2(interaction, 'Validando o boost…', { ephemeral: true });
    const settings = await getModuleConfig(context.database, 'levels', DEFAULT_LEVEL_SETTINGS);
    const target = kind === 'role'
      ? interaction.guild.roles.cache.get(targetId)
      : interaction.guild.channels.cache.get(targetId);
    if (
      !target
      || (kind === 'channel' && ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(target.type))
    ) {
      await editReplyV2(interaction, 'O cargo ou canal selecionado não está mais disponível.', { ephemeral: true });
      return true;
    }
    if (multiplier !== 0 && (multiplier < 1 || multiplier > settings.maxBoostMultiplier)) {
      await editReplyV2(
        interaction,
        `Informe 0 para remover ou um multiplicador entre 1 e ${settings.maxBoostMultiplier}.`,
        { ephemeral: true },
      );
      return true;
    }

    const setting = kind === 'role' ? 'roleBoosts' : 'channelBoosts';
    if (multiplier === 0) {
      await removeModuleConfigValue(context.database, 'levels', `${setting}.${targetId}`);
    } else {
      await updateModuleConfigValue(context.database, 'levels', `${setting}.${targetId}`, multiplier);
    }
    const targetType = kind === 'role' ? 'cargo' : 'canal';
    const result = multiplier === 0
      ? `Boost removido do ${targetType}.`
      : `Boost de ${multiplier}× salvo para o ${targetType}.`;
    await editReplyV2(interaction, result, { ephemeral: true });
    return true;
  }

  return false;
}
