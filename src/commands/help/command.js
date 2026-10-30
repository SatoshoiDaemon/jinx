import { SlashCommandBuilder } from 'discord.js';
import { replyV2 } from '../../modules/common/components-v2.js';

const HELP_TEXT = [
  '## Comandos do Jinx',
  '',
  '`/choose opcoes` — escolhe entre opções separadas por vírgulas, como `pizza, hambúrguer, sushi`.',
  'Envie uma expressão como `2d6+3` em uma mensagem para rolar dados.',
  '`/nivel consultar [membro]` — consulta nível e XP seu ou de outra pessoa.',
  '`/nivel adicionar` e `/nivel remover` — ajustam níveis (Gerenciar servidor).',
  '`/xp adicionar` e `/xp remover` — ajustam XP (Gerenciar servidor).',
  '`/perfil [membro]` — mostra dados básicos e o banner público disponível.',
  '`/painel` — abre as configurações dos sistemas do Jinx (Gerenciar servidor).',
  '`/botinfo`, `/uptime` e `/ping` — informações do bot e latência.',
].join('\n');

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Lista os comandos e explica como usá-los'),

  async execute(interaction) {
    await replyV2(interaction, HELP_TEXT);
  },
};
