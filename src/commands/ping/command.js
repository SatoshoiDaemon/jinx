import { SlashCommandBuilder } from 'discord.js';
import { replyV2 } from '../../modules/common/components-v2.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Mostra as latências da interação e do WebSocket'),

  async execute(interaction) {
    const interactionLatency = Math.max(0, Date.now() - interaction.createdTimestamp);
    const websocketLatency = interaction.client.ws.ping;
    const websocketText = Number.isFinite(websocketLatency) && websocketLatency >= 0
      ? `${Math.round(websocketLatency)} ms`
      : 'indisponível';

    await replyV2(
      interaction,
      `Latência da interação: **${interactionLatency} ms**\nLatência do WebSocket: **${websocketText}**`,
    );
  },
};
