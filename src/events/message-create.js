import { Events } from 'discord.js';
import { awardMessageXp } from '../modules/levels/service.js';

export function registerMessageCreate(client, context) {
  client.on(Events.MessageCreate, async (message) => {
    if (
      !message.guildId
      || message.guildId !== context.guildId
      || message.author.bot
      || !message.member
    ) {
      return;
    }

    try {
      await awardMessageXp(context.database, {
        guildId: message.guildId,
        userId: message.author.id,
        channelId: message.channelId,
        roleIds: message.member ? [...message.member.roles.cache.keys()] : [],
      });
    } catch (error) {
      console.error(`[Níveis] Falha ao conceder XP em mensagem (${error?.name ?? 'Erro'}).`);
    }
  });
}
