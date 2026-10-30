import { SlashCommandBuilder, version as discordJsVersion } from 'discord.js';
import { formatDuration, escapeDiscordText } from '../../modules/common/format.js';
import { replyV2 } from '../../modules/common/components-v2.js';

export default {
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Mostra informações úteis do bot'),

  async execute(interaction) {
    const client = interaction.client;
    const name = escapeDiscordText(client.user?.username ?? 'Jinx');
    const uptime = formatDuration(process.uptime());
    const guildCount = client.guilds.cache.size;
    await replyV2(
      interaction,
      `## ${name}\n\nID: \`${client.user?.id ?? 'indisponível'}\`\nGuildas conectadas: ${guildCount}\nUptime: ${uptime}\nNode.js: ${process.version}\ndiscord.js: ${discordJsVersion}`,
    );
  },
};
