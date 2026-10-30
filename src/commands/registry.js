import botinfo from './botinfo/command.js';
import choose from './choose/command.js';
import help from './help/command.js';
import nivel from './nivel/command.js';
import painel from './painel/command.js';
import perfil from './perfil/command.js';
import ping from './ping/command.js';
import roll from './roll/command.js';
import uptime from './uptime/command.js';
import xp from './xp/command.js';

export const commands = [botinfo, choose, help, nivel, painel, perfil, ping, roll, uptime, xp];
export const commandsByName = new Map(commands.map((command) => [command.data.name, command]));
