import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { escapeDiscordText } from '../../modules/common/format.js';
import { adjustYenByAdmin, formatYen } from '../../modules/economy/service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remover')
    .setDescription('Comando administrativo de Yen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName('yen')
      .setDescription('Remove Yen da carteira de um membro')
      .addUserOption((option) => option
        .setName('membro')
        .setDescription('Membro que perderá Yen')
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('quantidade')
        .setDescription('Quantidade inteira de Yen')
        .setMinValue(1)
        .setMaxValue(1_000_000_000)
        .setRequired(true))),

  async execute(interaction, context) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor**.', { ephemeral: true });
      return;
    }
    const user = interaction.options.getUser('membro', true);
    const amount = interaction.options.getInteger('quantidade', true);
    await replyV2(interaction, 'Removendo Yen da carteira…', { ephemeral: true });
    try {
      const wallet = await adjustYenByAdmin(context.database, {
        userId: user.id,
        adminId: interaction.user.id,
        direction: 'remove',
        amount,
      });
      await editReplyV2(
        interaction,
        `Removidos **${formatYen(amount)}** de ${escapeDiscordText(user.globalName ?? user.username)}. Saldo restante: **${formatYen(wallet.balance)}**.`,
        { ephemeral: true },
      );
    } catch (error) {
      const message = error.message === 'INSUFFICIENT_BALANCE'
        ? 'A carteira não tem Yen suficiente para essa remoção.'
        : error.message === 'TRANSFER_PENDING'
          ? 'Uma transferência está sendo processada para essa carteira. Tente novamente em instantes.'
          : error.message === 'ECONOMY_DISABLED'
            ? 'O sistema de economia está desativado no painel.'
            : null;
      if (!message) {
        throw error;
      }
      await editReplyV2(interaction, message, { ephemeral: true });
    }
  },
};
