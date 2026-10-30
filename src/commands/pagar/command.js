import { SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { escapeDiscordText } from '../../modules/common/format.js';
import { formatYen, transferYen } from '../../modules/economy/service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pagar')
    .setDescription('Transfere Yen para outro membro')
    .addUserOption((option) => option
      .setName('membro')
      .setDescription('Membro que receberá Yen')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('valor')
      .setDescription('Quantidade inteira de Yen')
      .setMinValue(1)
      .setMaxValue(1_000_000_000)
      .setRequired(true)),

  async execute(interaction, context) {
    const recipient = interaction.options.getUser('membro', true);
    const amount = interaction.options.getInteger('valor', true);
    if (recipient.id === interaction.user.id) {
      await replyV2(interaction, 'Você não pode transferir Yen para si mesmo.', { ephemeral: true });
      return;
    }
    if (recipient.bot) {
      await replyV2(interaction, 'Não é possível transferir Yen para bots.', { ephemeral: true });
      return;
    }

    await replyV2(interaction, 'Processando a transferência…', { ephemeral: true });
    try {
      const result = await transferYen(context.mongoClient, context.database, {
        operationId: interaction.id,
        fromUserId: interaction.user.id,
        toUserId: recipient.id,
        amount,
      });
      await editReplyV2(
        interaction,
        `Transferência concluída: **${formatYen(amount)}** enviados para ${escapeDiscordText(recipient.globalName ?? recipient.username)}.\nSeu saldo: **${formatYen(result.sender.balance)}**. Saldo do destinatário: **${formatYen(result.recipient.balance)}**.`,
        { ephemeral: true },
      );
    } catch (error) {
      const message = error.message === 'INSUFFICIENT_BALANCE'
        ? 'Você não tem Yen suficiente para essa transferência.'
        : error.message === 'INVALID_TRANSFER_AMOUNT'
          ? 'O valor está fora dos limites de transferência configurados no painel.'
          : error.message === 'BALANCE_LIMIT_REACHED'
            ? 'A carteira do destinatário atingiu o limite seguro de saldo.'
            : error.message === 'TRANSFER_BUSY'
              ? 'Outra transferência está sendo finalizada. Tente novamente em instantes.'
              : error.message === 'TRANSFER_PENDING' || error.message === 'TRANSFER_RECIPIENT_BUSY'
                ? 'Uma das carteiras está processando outra transferência. Tente novamente em instantes.'
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
