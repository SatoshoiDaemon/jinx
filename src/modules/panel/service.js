import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, saveGuildBoost, saveGuildSettings } from '../../models/guild-config.js';
import { editReplyV2, replyV2 } from '../common/components-v2.js';
import { validateGuildSettings } from '../levels/rules.js';
import { buildBoostLimitModal, buildBoostModal, buildSettingsModal } from './components.js';

function hasPanelPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function isConfiguredGuild(interaction, guildId) {
  return interaction.inGuild() && interaction.guildId === guildId;
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

export async function handlePanelInteraction(interaction, context) {
  if (
    !interaction.customId?.startsWith('panel:')
    || (!interaction.isButton() && !interaction.isRoleSelectMenu()
      && !interaction.isChannelSelectMenu() && !interaction.isModalSubmit())
  ) {
    return false;
  }

  if (!isConfiguredGuild(interaction, context.guildId)) {
    await replyV2(interaction, 'Este painel só funciona na guilda configurada.', { ephemeral: true });
    return true;
  }
  if (!hasPanelPermission(interaction)) {
    await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor** para usar este painel.', { ephemeral: true });
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

  if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:role') {
    await interaction.showModal(buildBoostModal('role', interaction.values[0]));
    return true;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'panel:channel') {
    await interaction.showModal(buildBoostModal('channel', interaction.values[0]));
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'panel:modal:settings') {
    await replyV2(interaction, 'Salvando as configurações…', { ephemeral: true });
    const current = await getGuildConfig(context.database, context.guildId);
    const fields = interaction.fields;
    let settings;
    try {
      settings = validateGuildSettings({
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
    await saveGuildSettings(context.database, context.guildId, settings);
    await editReplyV2(interaction, 'Configurações de XP atualizadas.', { ephemeral: true });
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'panel:modal:boost-limit') {
    await replyV2(interaction, 'Salvando o limite de boosts…', { ephemeral: true });
    const current = await getGuildConfig(context.database, context.guildId);
    let settings;
    try {
      settings = validateGuildSettings({
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
    await saveGuildSettings(context.database, context.guildId, settings);
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
    const settings = await getGuildConfig(context.database, context.guildId);
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

    await saveGuildBoost(
      context.database,
      context.guildId,
      kind,
      targetId,
      multiplier === 0 ? null : multiplier,
    );
    const targetType = kind === 'role' ? 'cargo' : 'canal';
    const result = multiplier === 0
      ? `Boost removido do ${targetType}.`
      : `Boost de ${multiplier}× salvo para o ${targetType}.`;
    await editReplyV2(interaction, result, { ephemeral: true });
    return true;
  }

  return false;
}
