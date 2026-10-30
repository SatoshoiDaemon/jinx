import { SlashCommandBuilder } from 'discord.js';
import { formatDuration } from '../../modules/common/format.js';
import { replyV2 } from '../../modules/common/components-v2.js';

export default {
  data: new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Mostra há quanto tempo o bot está ativo'),

  async execute(interaction) {
    await replyV2(interaction, `Estou ativo há **${formatDuration(process.uptime())}**.`);
  },
};
