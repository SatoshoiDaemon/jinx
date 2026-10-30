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
import { handleWelcomePanelInteraction } from '../welcome/panel.js';
import {
  buildBoostLimitModal,
  buildBoostModal,
  buildPanelRows,
  buildSettingsModal,
  PANEL_CATEGORIES,
  renderPanelContent,
} from './components.js';

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

async function showCategory(interaction, database, category, alreadyDeferred = false) {
  if (!PANEL_CATEGORIES.some((item) => item.id === category)) {
    await replyV2(interaction, 'Esta categoria do painel não está disponível.', { ephemeral: true });
    return;
  }

  if (!alreadyDeferred) {
    await interaction.deferUpdate();
  }
  let settings;
  if (category === 'levels') {
    settings = await getModuleConfig(database, 'levels', DEFAULT_LEVEL_SETTINGS);
  } else if (category === 'welcome') {
    settings = await getWelcomeSettings(database);
  } else if (category === 'voice_calls') {
    settings = await getModuleConfig(database, 'voice_calls', DEFAULT_VOICE_CALL_SETTINGS);
  }
  await interaction.editReply(v2EditPayload(
    renderPanelContent(category, settings, interaction.guild),
    { rows: buildPanelRows(category, 'overview', settings) },
  ));
}

export async function handlePanelInteraction(interaction, context) {
  if (
    !interaction.customId?.startsWith('panel:')
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

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:category') {
    await showCategory(interaction, context.database, interaction.values[0]);
    return true;
  }

  if (interaction.customId.startsWith('panel:welcome:')) {
    return handleWelcomePanelInteraction(interaction, context);
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
