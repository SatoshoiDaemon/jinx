import { MediaGalleryBuilder, SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { escapeDiscordText } from '../../modules/common/format.js';
import { formatYen, readWallet } from '../../modules/economy/service.js';
import { getEconomyRanking } from '../../modules/economy/ranking.js';

const TRANSACTION_LABELS = Object.freeze({
  starting_balance: 'Saldo inicial',
  daily: 'Recompensa diária',
  work: 'Trabalho',
  crime_success: 'Crime fictício',
  crime_failure: 'Multa fictícia',
  admin_add: 'Ajuste administrativo',
  admin_remove: 'Remoção administrativa',
  transfer_in: 'Transferência recebida',
  transfer_out: 'Transferência enviada',
  game_stake: 'Aposta',
  game_payout: 'Pagamento de aposta',
  game_refund: 'Aposta devolvida',
});

async function fetchGuildMember(guild, userId) {
  const cached = guild.members.cache.get(userId);
  if (cached) {
    return cached;
  }
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch (error) {
    if (Number(error?.code) === 10007) {
      return null;
    }
    throw error;
  }
}

function transactionText(transaction) {
  const direction = transaction.direction === 'in' ? '+' : '−';
  const label = TRANSACTION_LABELS[transaction.type] ?? 'Movimentação';
  const date = new Date(transaction.at).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  return `• ${label}: ${direction}${formatYen(transaction.amount)} — ${date} UTC`;
}

function walletContent({ displayName, user, wallet, position }) {
  const stats = wallet.stats ?? {};
  const recent = (wallet.transactions ?? []).slice(-4).reverse();
  const transactionSummary = recent.length
    ? recent.map(transactionText).join('\n')
    : 'Nenhuma movimentação registrada.';
  return [
    `## Carteira de ${escapeDiscordText(displayName)}`,
    '',
    `Usuário: \`${escapeDiscordText(user.username)}\``,
    `ID: \`${user.id}\``,
    `Saldo: **${formatYen(wallet.balance)}**`,
    `Posição econômica: **#${position}**`,
    '',
    `Recebido: ${formatYen(wallet.totalReceived ?? 0)} · Gasto/perdido: ${formatYen(wallet.totalSpent ?? 0)}`,
    `Apostas: ${stats.betsWon ?? 0} vitórias · ${stats.betsLost ?? 0} derrotas · ${formatYen(stats.totalWagered ?? 0)} apostados`,
    '',
    '**Movimentações recentes**',
    transactionSummary,
  ].join('\n');
}

export default {
  data: new SlashCommandBuilder()
    .setName('carteira')
    .setDescription('Consulta sua carteira ou a de outro membro')
    .addUserOption((option) => option
      .setName('membro')
      .setDescription('Membro cuja carteira deseja consultar')
      .setRequired(false)),

  async execute(interaction, context) {
    const user = interaction.options.getUser('membro') ?? interaction.user;
    await replyV2(interaction, 'Consultando a carteira…', { ephemeral: true });
    const [wallet, ranking, member] = await Promise.all([
      readWallet(context.database, user.id),
      getEconomyRanking(context.database, user.id),
      fetchGuildMember(interaction.guild, user.id),
    ]);
    const displayName = member?.displayName ?? user.globalName ?? user.username;
    const avatarUrl = user.displayAvatarURL({ size: 512 });
    const media = avatarUrl
      ? [new MediaGalleryBuilder().addItems({
        media: { url: avatarUrl },
        description: `Avatar de ${escapeDiscordText(displayName)}`,
      })]
      : [];
    await editReplyV2(
      interaction,
      walletContent({ displayName, user, wallet, position: ranking.userPosition }),
      { ephemeral: true, media },
    );
  },
};
