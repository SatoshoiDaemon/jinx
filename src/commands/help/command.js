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
  '`/carteira [membro]`, `/daily`, `/trabalhar` e `/crime` — consultam ou movimentam Yen virtual.',
  '`/pagar membro valor` — transfere Yen para outro membro.',
  '`/aposta blackjack|roleta|slots|moeda|dados` — jogos com Yen fictício, sem dinheiro real.',
  '`/ranking economia|nivel` — exibe os rankings de saldo e nível.',
  '`/adicionar yen` e `/remover yen` — ajustes administrativos (Gerenciar servidor).',
  '`/painel` — configura níveis, economia, boas-vindas, calls e painéis de tickets (Gerenciar servidor).',
  'Painéis de atendimento abrem tickets privados por formulário; o controle fica fixado no tópico.',
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
