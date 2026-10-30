import { SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { formatCooldown, formatYen, workForYen } from '../../modules/economy/service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('trabalhar')
    .setDescription('Realiza um trabalho fictício por Yen'),

  async execute(interaction, context) {
    await replyV2(interaction, 'Procurando um trabalho…', { ephemeral: true });
    let result;
    try {
      result = await workForYen(context.database, interaction.user.id);
    } catch (error) {
      if (error.message !== 'ECONOMY_DISABLED') throw error;
      await editReplyV2(interaction, 'O sistema de economia está desativado no painel.', { ephemeral: true });
      return;
    }
    let message;
    if (result.status === 'claimed') {
      message = `## Trabalho concluído\n\nVocê ${result.narrative} e recebeu **${formatYen(result.reward)}**.\nSaldo atual: **${formatYen(result.balance)}**.`;
    } else if (result.status === 'cooldown') {
      message = `Você já trabalhou recentemente. Tente novamente em **${formatCooldown(result.remainingMs)}**.`;
    } else if (result.status === 'transfer_pending') {
      message = 'Uma transferência está sendo processada. Tente trabalhar novamente em instantes.';
    } else if (result.status === 'balance_limit') {
      message = 'Sua carteira atingiu o limite seguro de saldo.';
    } else {
      message = 'O saldo mudou durante a operação. Tente novamente.';
    }
    await editReplyV2(interaction, message, { ephemeral: true });
  },
};
