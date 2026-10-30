import { REST, Routes } from 'discord.js';
import { commands } from './registry.js';

export async function registerGuildCommands(config) {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.guildId),
    { body: commands.map((command) => command.data.toJSON()) },
  );
}
