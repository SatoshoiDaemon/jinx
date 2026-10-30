import { randomInt } from 'node:crypto';
import { SlashCommandBuilder } from 'discord.js';
import { COMMAND_LIMITS } from '../../config/defaults.js';
import { escapeDiscordText } from '../../modules/common/format.js';
import { replyV2 } from '../../modules/common/components-v2.js';

export default {
  data: new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Escolhe uma opção separada por |')
    .addStringOption((option) => option
      .setName('opcoes')
      .setDescription('Duas ou mais opções separadas por |')
      .setRequired(true)
      .setMaxLength(COMMAND_LIMITS.maxChooseLength)),

  async execute(interaction) {
    const options = interaction.options.getString('opcoes')
      .split('|')
      .map((option) => option.trim())
      .filter(Boolean);

    if (options.length < 2) {
      await replyV2(interaction, 'Informe pelo menos duas opções não vazias, separadas por `|`.', { ephemeral: true });
      return;
    }

    const choice = options[randomInt(options.length)];
    await replyV2(interaction, `Minha escolha: **${escapeDiscordText(choice)}**`);
  },
};
