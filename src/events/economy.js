import { Events } from 'discord.js';
import { recoverGameStates } from '../modules/economy/repository.js';
import { recoverFallbackTransfer } from '../modules/economy/transfers.js';
import { initializeEconomyWalletsForMembers } from '../modules/economy/service.js';

export function registerEconomyRecovery(client, context) {
  let running = false;
  const recover = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await recoverFallbackTransfer(context.database);
      await recoverGameStates(context.database);
    } catch (error) {
      console.error(`[Economia] Falha ao recuperar operações pendentes (${error?.name ?? 'Erro'}).`);
    } finally {
      running = false;
    }
  };

  client.once(Events.ClientReady, (readyClient) => {
    void recover();
    void (async () => {
      try {
        const guild = readyClient.guilds.cache.get(context.guildId)
          ?? await readyClient.guilds.fetch(context.guildId);
        const members = await guild.members.fetch();
        await initializeEconomyWalletsForMembers(members, context);
      } catch (error) {
        console.error(`[Economia] Falha ao inicializar carteiras da guilda (${error?.name ?? 'Erro'}).`);
      }
    })();
    const timer = setInterval(() => void recover(), 30_000);
    timer.unref();
  });
}
