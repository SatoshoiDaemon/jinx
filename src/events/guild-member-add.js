import { Events } from 'discord.js';
import { initializeEconomyWalletForMember } from '../modules/economy/service.js';
import { processWelcomeMember } from '../modules/welcome/service.js';

export function registerGuildMemberAdd(client, context) {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      await processWelcomeMember(member, context);
    } catch (error) {
      console.error(`[Boas-vindas] Falha ao processar entrada de membro (${error?.name ?? 'Erro'}).`);
    }
    try {
      await initializeEconomyWalletForMember(member, context);
    } catch (error) {
      console.error(`[Economia] Falha ao criar carteira do novo membro (${error?.name ?? 'Erro'}).`);
    }
  });
}
