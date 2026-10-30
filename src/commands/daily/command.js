import { SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { formatCooldown, formatYen, claimDailyReward } from '../../modules/economy/service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Resgata sua recompensa diária em Yen'),

  async execute(interaction, context) {
    await replyV2(interaction, 'Verificando sua recompensa diária…', { ephemeral: true });
    let result;
    try {
      result = await claimDailyReward(context.database, interaction.user.id);
    } catch (error) {
      if (error.message !== 'ECONOMY_DISABLED') throw error;
      await editReplyV2(interaction, 'O sistema de economia está desativado no painel.', { ephemeral: true });
      return;
    }
    let message;
    if (result.status === 'claimed') {
      message = `## Recompensa diária\n\nVocê recebeu **${formatYen(result.reward)}**.${result.streak > 0 ? `\nSequência: **${result.streak} dia(s)**.` : ''}\nSaldo atual: **${formatYen(result.balance)}**.`;
    } else if (result.status === 'cooldown') {
      message = `Sua recompensa diária já foi resgatada. Volte em **${formatCooldown(result.remainingMs)}**.`;
    } else if (result.status === 'transfer_pending') {
      message = 'Uma transferência está sendo processada. Tente resgatar novamente em instantes.';
    } else if (result.status === 'balance_limit') {
      message = 'Sua carteira atingiu o limite seguro de saldo.';
    } else {
      message = 'O saldo mudou durante a operação. Tente novamente.';
    }
    await editReplyV2(interaction, message, { ephemeral: true });
  },
};
