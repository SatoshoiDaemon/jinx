import { SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { escapeDiscordText } from '../../modules/common/format.js';
import { formatYen } from '../../modules/economy/service.js';
import { getEconomyRanking, getLevelRanking } from '../../modules/economy/ranking.js';

async function memberName(guild, userId) {
  const cached = guild.members.cache.get(userId);
  if (cached) {
    return escapeDiscordText(cached.displayName);
  }
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    return escapeDiscordText(member.displayName);
  } catch (error) {
    if (Number(error?.code) === 10007) {
      return 'Membro saiu da guilda';
    }
    return 'Membro indisponível';
  }
}

async function economyRanking(database, guild, userId) {
  const ranking = await getEconomyRanking(database, userId);
  const rows = await Promise.all(ranking.entries.map(async (entry, index) => (
    `**${index + 1}.** ${await memberName(guild, entry._id)} — **${formatYen(entry.balance)}**`
  )));
  const userInTop = ranking.entries.some((entry) => entry._id === userId);
  const ownPosition = userInTop
    ? ''
    : `\nSua posição: **#${ranking.userPosition}** — ${formatYen(ranking.userWallet.balance)}.`;
  return [
    '## Ranking econômico — Yen',
    '',
    rows.length ? rows.join('\n') : 'Ainda não há carteiras no ranking.',
    ownPosition,
  ].filter(Boolean).join('\n');
}

async function levelRanking(database, guild, userId) {
  const ranking = await getLevelRanking(database, userId);
  const rows = await Promise.all(ranking.entries.map(async (entry, index) => (
    `**${index + 1}.** ${await memberName(guild, entry.userId)} — nível **${entry.level}**, **${entry.totalXp} XP**`
  )));
  const userInTop = ranking.entries.some((entry) => entry.userId === userId);
  const ownPosition = userInTop
    ? ''
    : `\nSua posição: **#${ranking.userPosition}** — nível **${ranking.userEntry.level}**, **${ranking.userEntry.totalXp} XP**.`;
  return [
    '## Ranking de níveis',
    '',
    rows.length ? rows.join('\n') : 'Ainda não há membros no ranking de XP.',
    ownPosition,
  ].filter(Boolean).join('\n');
}

export default {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Exibe os rankings de Yen ou níveis')
    .addSubcommand((subcommand) => subcommand
      .setName('economia')
      .setDescription('Top 10 por saldo de Yen'))
    .addSubcommand((subcommand) => subcommand
      .setName('nivel')
      .setDescription('Top 10 por nível e XP total')),

  async execute(interaction, context) {
    const mode = interaction.options.getSubcommand();
    await replyV2(interaction, 'Consultando o ranking…');
    const content = mode === 'economia'
      ? await economyRanking(context.database, interaction.guild, interaction.user.id)
      : await levelRanking(context.database, interaction.guild, interaction.user.id);
    await editReplyV2(interaction, content);
  },
};
