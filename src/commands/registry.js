import botinfo from './botinfo/command.js';
import adicionar from './adicionar/command.js';
import aposta from './aposta/command.js';
import carteira from './carteira/command.js';
import choose from './choose/command.js';
import crime from './crime/command.js';
import daily from './daily/command.js';
import help from './help/command.js';
import nivel from './nivel/command.js';
import painel from './painel/command.js';
import pagar from './pagar/command.js';
import perfil from './perfil/command.js';
import ping from './ping/command.js';
import ranking from './ranking/command.js';
import remover from './remover/command.js';
import trabalhar from './trabalhar/command.js';
import uptime from './uptime/command.js';
import xp from './xp/command.js';

export const commands = [
  adicionar,
  aposta,
  botinfo,
  carteira,
  choose,
  crime,
  daily,
  help,
  nivel,
  painel,
  pagar,
  perfil,
  ping,
  ranking,
  remover,
  trabalhar,
  uptime,
  xp,
];
export const commandsByName = new Map(commands.map((command) => [command.data.name, command]));
