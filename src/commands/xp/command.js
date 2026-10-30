import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { escapeDiscordText } from '../../modules/common/format.js';
import { adjustMemberXp } from '../../modules/levels/service.js';

function addAdjustmentOptions(subcommand) {
  return subcommand
    .addUserOption((option) => option
      .setName('membro')
      .setDescription('Membro que terá o XP ajustado')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('quantidade')
      .setDescription('Quantidade de XP')
      .setMinValue(1)
      .setMaxValue(Number.MAX_SAFE_INTEGER)
      .setRequired(true));
}

function hasManageServer(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function expectedXpError(error) {
  const messages = {
    INSUFFICIENT_XP: 'O membro não tem XP suficiente para essa remoção.',
    XP_LIMIT_REACHED: 'O ajuste ultrapassaria o limite seguro de XP.',
  };
  return messages[error.message];
}

export default {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Adiciona ou remove XP de um membro')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => addAdjustmentOptions(subcommand
      .setName('adicionar')
      .setDescription('Adiciona XP a um membro')))
    .addSubcommand((subcommand) => addAdjustmentOptions(subcommand
      .setName('remover')
      .setDescription('Remove XP de um membro'))),

  async execute(interaction, context) {
    if (!hasManageServer(interaction)) {
      await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor** para ajustar XP.', { ephemeral: true });
      return;
    }

    const action = interaction.options.getSubcommand();
    const direction = action === 'adicionar' ? 'add' : 'remove';
    const member = interaction.options.getUser('membro');
    const amount = interaction.options.getInteger('quantidade');
    await replyV2(interaction, 'Aplicando o ajuste de XP…', { ephemeral: true });
    try {
      const updated = await adjustMemberXp(context.database, member.id, direction, amount);
      const actionText = direction === 'add' ? 'adicionado' : 'removido';
      await editReplyV2(
        interaction,
        `${amount} XP ${actionText} de ${escapeDiscordText(member.globalName ?? member.username)}. Total atual: **${updated.totalXp} XP**.`,
        { ephemeral: true },
      );
    } catch (error) {
      const message = expectedXpError(error);
      if (!message) {
        throw error;
      }
      await editReplyV2(interaction, message, { ephemeral: true });
    }
  },
};
