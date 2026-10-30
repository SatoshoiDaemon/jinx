import { SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { formatCooldown, formatYen, commitFictionalCrime } from '../../modules/economy/service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('crime')
    .setDescription('Tenta um crime fictício por Yen, com risco e multa'),

  async execute(interaction, context) {
    await replyV2(interaction, 'Calculando o resultado do crime fictício…', { ephemeral: true });
    let result;
    try {
      result = await commitFictionalCrime(context.database, interaction.user.id);
    } catch (error) {
      if (error.message !== 'ECONOMY_DISABLED') throw error;
      await editReplyV2(interaction, 'O sistema de economia está desativado no painel.', { ephemeral: true });
      return;
    }
    const odds = `Chance de sucesso: **${result.successChancePercent}%**. Recompensa: **${formatYen(result.minReward)}–${formatYen(result.maxReward)}**; multa em caso de falha: **${formatYen(result.minFine)}–${formatYen(result.maxFine)}**.`;
    let outcome;
    if (result.status === 'completed') {
      outcome = result.success
        ? `Você ${result.narrative} **${formatYen(result.amount)}**.`
        : result.amount > 0
          ? `Você ${result.narrative} **${formatYen(result.amount)}**.`
          : 'Você foi descoberto; não havia saldo para cobrar a multa.';
      outcome += `\nSaldo atual: **${formatYen(result.balance)}**.`;
    } else if (result.status === 'cooldown') {
      outcome = `Você já tentou recentemente. Tente novamente em **${formatCooldown(result.remainingMs)}**.`;
    } else if (result.status === 'transfer_pending') {
      outcome = 'Uma transferência está sendo processada. Tente novamente em instantes.';
    } else if (result.status === 'balance_limit') {
      outcome = 'Sua carteira atingiu o limite seguro de saldo.';
    } else {
      outcome = 'O saldo mudou durante a operação. Tente novamente.';
    }
    await editReplyV2(
      interaction,
      `## Crime fictício\n\n${odds}\n\n${outcome}`,
      { ephemeral: true },
    );
  },
};
