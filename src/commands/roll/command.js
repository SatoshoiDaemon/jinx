import { SlashCommandBuilder } from 'discord.js';
import { replyV2 } from '../../modules/common/components-v2.js';
import { rollDice } from '../../modules/dice/roll.js';

export default {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Rola dados com uma expressão como 2d6+3')
    .addStringOption((option) => option
      .setName('expressao')
      .setDescription('Formato: quantidade d faces, com modificador opcional')
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(32)),

  async execute(interaction) {
    const expression = interaction.options.getString('expressao');
    let result;
    try {
      result = rollDice(expression);
    } catch (error) {
      if (error.message === 'INVALID_DICE_EXPRESSION') {
        await replyV2(interaction, 'Use uma expressão válida, como `2d6+3` ou `1d20-2`.', { ephemeral: true });
        return;
      }
      if (error.message === 'DICE_LIMIT_EXCEEDED') {
        await replyV2(interaction, 'A expressão excede os limites de dados, faces ou modificador.', { ephemeral: true });
        return;
      }
      throw error;
    }

    const modifier = result.modifier === 0 ? '' : ` ${result.modifier > 0 ? '+' : '−'} ${Math.abs(result.modifier)}`;
    await replyV2(
      interaction,
      `**${expression}** → resultados: ${result.results.join(', ')}${modifier}. Total: **${result.total}**.`,
    );
  },
};
