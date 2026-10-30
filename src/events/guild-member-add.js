import { Events } from 'discord.js';
import { processWelcomeMember } from '../modules/welcome/service.js';

export function registerGuildMemberAdd(client, context) {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      await processWelcomeMember(member, context);
    } catch (error) {
      console.error(`[Boas-vindas] Falha ao processar entrada de membro (${error?.name ?? 'Erro'}).`);
    }
  });
}
