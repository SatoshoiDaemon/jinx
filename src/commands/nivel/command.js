import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { escapeDiscordText } from '../../modules/common/format.js';
import { adjustMemberLevels, getMemberProgress } from '../../modules/levels/service.js';

function hasManageServer(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

function addMemberOption(subcommand) {
  return subcommand.addUserOption((option) => option
    .setName('membro')
    .setDescription('Membro que terá o nível ajustado')
    .setRequired(true));
}

function addAmountOption(subcommand) {
  return subcommand.addIntegerOption((option) => option
    .setName('quantidade')
    .setDescription('Quantidade de níveis')
    .setMinValue(1)
    .setMaxValue(Number.MAX_SAFE_INTEGER)
    .setRequired(true));
}

function renderProgress(name, progress) {
  const nextLevel = progress.xpRemaining === null
    ? 'Limite seguro de XP atingido.'
    : `Progresso no nível: **${progress.xpIntoLevel} / ${progress.xpToNextLevel} XP**\nFaltam **${progress.xpRemaining} XP** para o próximo nível.`;
  return `## Nível de ${escapeDiscordText(name)}\n\nNível: **${progress.level}**\nXP total: **${progress.totalXp}**\n${nextLevel}`;
}

function expectedLevelError(error) {
  const messages = {
    LEVEL_FLOOR_REACHED: 'O nível não pode ficar abaixo de 1.',
    XP_LIMIT_REACHED: 'O ajuste ultrapassaria o limite seguro de XP.',
    XP_CHANGED_CONCURRENTLY: 'Os dados mudaram durante o ajuste. Tente novamente.',
  };
  return messages[error.message];
}

export default {
  data: new SlashCommandBuilder()
    .setName('nivel')
    .setDescription('Consulta ou ajusta o nível de um membro')
    .addSubcommand((subcommand) => subcommand
      .setName('consultar')
      .setDescription('Consulta seu nível ou o de outra pessoa')
      .addUserOption((option) => option
        .setName('membro')
        .setDescription('Membro que deseja consultar')
        .setRequired(false)))
    .addSubcommand((subcommand) => addAmountOption(addMemberOption(subcommand
      .setName('adicionar')
      .setDescription('Adiciona níveis a um membro'))))
    .addSubcommand((subcommand) => addAmountOption(addMemberOption(subcommand
      .setName('remover')
      .setDescription('Remove níveis de um membro')))),

  async execute(interaction, context) {
    const action = interaction.options.getSubcommand();
    if (action === 'consultar') {
      const member = interaction.options.getUser('membro') ?? interaction.user;
      await replyV2(interaction, 'Consultando o nível…');
      const progress = await getMemberProgress(context.database, context.guildId, member.id);
      await editReplyV2(interaction, renderProgress(member.globalName ?? member.username, progress));
      return;
    }

    if (!hasManageServer(interaction)) {
      await replyV2(interaction, 'Você precisa da permissão **Gerenciar servidor** para ajustar níveis.', { ephemeral: true });
      return;
    }

    const member = interaction.options.getUser('membro');
    const amount = interaction.options.getInteger('quantidade');
    const direction = action === 'adicionar' ? 1 : -1;
    await replyV2(interaction, 'Aplicando o ajuste de nível…', { ephemeral: true });
    try {
      const adjusted = await adjustMemberLevels(
        context.database,
        context.guildId,
        member.id,
        direction * amount,
      );
      const actionText = direction > 0 ? 'adicionado' : 'removido';
      await editReplyV2(
        interaction,
        `${amount} nível(is) ${actionText} de ${escapeDiscordText(member.globalName ?? member.username)}. Novo nível: **${adjusted.level}** (${adjusted.totalXp} XP).`,
        { ephemeral: true },
      );
    } catch (error) {
      const message = expectedLevelError(error);
      if (!message) {
        throw error;
      }
      await editReplyV2(interaction, message, { ephemeral: true });
    }
  },
};
