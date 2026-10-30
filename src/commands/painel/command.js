import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { getGuildConfig } from '../../models/guild-config.js';
import { buildPanelRows } from '../../modules/panel/components.js';

function hasManageServer(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

export default {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Abre o painel de configurações de XP')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, context) {
    if (!interaction.inGuild() || interaction.guildId !== context.guildId) {
      await replyV2(interaction, 'Este painel só funciona na guilda configurada.', { ephemeral: true });
      return;
    }
    if (!hasManageServer(interaction)) {
      await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor** para abrir o painel.', { ephemeral: true });
      return;
    }

    await replyV2(interaction, 'Carregando configurações…', { ephemeral: true });
    const settings = await getGuildConfig(context.database, context.guildId);
    const content = [
      '## Painel de níveis e XP',
      '',
      `XP por mensagem: **${settings.xpMin}–${settings.xpMax}**`,
      `Cooldown: **${settings.cooldownSeconds} s**`,
      `Curva: **${settings.xpBase} + nível × ${settings.xpStep}** XP`,
      `Boost máximo por cargo/canal: **${settings.maxBoostMultiplier}×**`,
      `Boosts ativos: **${Object.keys(settings.roleBoosts).length} cargos** e **${Object.keys(settings.channelBoosts).length} canais**.`,
      '',
      'Escolha um cargo ou canal para definir o boost. Informe `0` para removê-lo.',
    ].join('\n');

    await editReplyV2(interaction, content, { ephemeral: true, rows: buildPanelRows() });
  },
};
