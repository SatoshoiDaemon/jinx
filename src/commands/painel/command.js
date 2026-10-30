import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { replyV2 } from '../../modules/common/components-v2.js';
import { buildPanelRows, renderPanelContent } from '../../modules/panel/components.js';

function hasManageServer(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

export default {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Abre o painel de administração do Jinx')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, context) {
    if (!hasManageServer(interaction)) {
      await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor** para abrir o painel.', { ephemeral: true });
      return;
    }

    await replyV2(
      interaction,
      renderPanelContent('home'),
      { ephemeral: true, rows: buildPanelRows() },
    );
  },
};
