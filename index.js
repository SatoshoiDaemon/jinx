import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './src/config/environment.js';
import { connectDatabase } from './src/database/connection.js';
import { initializeDatabase } from './src/database/initialize.js';
import { registerGuildCommands } from './src/commands/register.js';
import { registerInteractionCreate } from './src/events/interaction-create.js';
import { registerMessageCreate } from './src/events/message-create.js';
import { registerGuildMemberAdd } from './src/events/guild-member-add.js';
import { registerVoiceCallEvents } from './src/events/voice-call.js';
import { registerEconomyRecovery } from './src/events/economy.js';
import { initializeEconomyRepository } from './src/modules/economy/repository.js';

async function startBot() {
  const config = loadConfig();
  const { client: mongoClient, database } = await connectDatabase(config);
  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const context = { database, guildId: config.guildId, mongoClient };

  try {
    await initializeDatabase(database, config.guildId);
    await initializeEconomyRepository(database);
    registerMessageCreate(discordClient, context);
    registerGuildMemberAdd(discordClient, context);
    registerInteractionCreate(discordClient, context);
    registerVoiceCallEvents(discordClient, context);
    registerEconomyRecovery(discordClient, context);
    discordClient.once(Events.ClientReady, (readyClient) => {
      console.info(`[Discord] Bot conectado como ${readyClient.user.tag}.`);
    });

    await registerGuildCommands(config);
    console.info('[Discord] Comandos da guilda registrados.');
    await discordClient.login(config.discordToken);

    let shutdownStarted = false;
    const shutdown = async (signal) => {
      if (shutdownStarted) {
        return;
      }
      shutdownStarted = true;
      console.info(`[Aplicação] Encerrando após ${signal}.`);
      discordClient.destroy();
      try {
        await mongoClient.close();
      } catch (error) {
        console.error(`[MongoDB] Falha ao encerrar a conexão (${error?.name ?? 'Erro'}).`);
        process.exitCode = 1;
      }
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    discordClient.destroy();
    await mongoClient.close();
    throw error;
  }
}

startBot().catch((error) => {
  if (error?.name === 'ConfigurationError') {
    console.error(`[Configuração] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error(`[Inicialização] Falha ao iniciar o bot (${error?.name ?? 'Erro'}).`);
  process.exitCode = 1;
});
