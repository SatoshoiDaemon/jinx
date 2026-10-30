import { SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { formatYen } from '../../modules/economy/service.js';
import { ROULETTE_BET_TYPES } from '../../modules/economy/games/casino.js';
import {
  buildBlackjackRows,
  renderBlackjackGame,
} from '../../modules/economy/games/blackjack.js';
import {
  createOrResumeBlackjack,
  playInstantGame,
} from '../../modules/economy/games/service.js';

function addBetOption(subcommand, { required = true } = {}) {
  return subcommand.addIntegerOption((option) => option
    .setName('aposta')
    .setDescription('Quantidade inteira de Yen para apostar')
    .setMinValue(1)
    .setMaxValue(1_000_000_000)
    .setRequired(required));
}

export default {
  data: new SlashCommandBuilder()
    .setName('aposta')
    .setDescription('Joga por Yen fictício, sem dinheiro real ou conversão')
    .addSubcommand((subcommand) => addBetOption(subcommand
      .setName('blackjack')
      .setDescription('Joga blackjack contra o dealer'), { required: false }))
    .addSubcommand((subcommand) => {
      const withBet = addBetOption(subcommand
        .setName('roleta')
        .setDescription('Aposta na roleta europeia'));
      withBet.addStringOption((option) => option
        .setName('tipo')
        .setDescription('Tipo de aposta')
        .setChoices(...ROULETTE_BET_TYPES)
        .setRequired(true));
      return withBet.addIntegerOption((option) => option
        .setName('numero')
        .setDescription('Número escolhido, obrigatório para número exato')
        .setMinValue(0)
        .setMaxValue(36)
        .setRequired(false));
    })
    .addSubcommand((subcommand) => addBetOption(subcommand
      .setName('slots')
      .setDescription('Joga no caça-níquel')))
    .addSubcommand((subcommand) => {
      const withBet = addBetOption(subcommand
        .setName('moeda')
        .setDescription('Aposta em cara ou coroa'));
      return withBet.addStringOption((option) => option
        .setName('lado')
        .setDescription('Escolha cara ou coroa')
        .addChoices(
          { name: 'Cara', value: 'cara' },
          { name: 'Coroa', value: 'coroa' },
        )
        .setRequired(true));
    })
    .addSubcommand((subcommand) => addBetOption(subcommand
      .setName('dados')
      .setDescription('Compara seu d20 com o d20 da casa'))),

  async execute(interaction, context) {
    const gameName = interaction.options.getSubcommand();
    const stake = interaction.options.getInteger('aposta');
    await replyV2(interaction, 'Preparando sua aposta…', { ephemeral: true });
    try {
      if (gameName === 'blackjack') {
        const result = await createOrResumeBlackjack(context.database, interaction.user.id, stake);
        if (result.status === 'playing' || result.status === 'resume') {
          await editReplyV2(
            interaction,
            renderBlackjackGame(result.game, {
              balance: result.balance,
              resultText: result.status === 'resume' ? 'Sua partida ativa foi restaurada.' : undefined,
            }),
            { ephemeral: true, rows: buildBlackjackRows(result.game) },
          );
          return;
        }
        if (result.status === 'settling') {
          await editReplyV2(
            interaction,
            `## Blackjack\n\nO resultado da partida foi registrado e o pagamento de ${formatYen(result.game.payout)} será aplicado assim que a transferência pendente terminar.`,
            { ephemeral: true },
          );
          return;
        }
        if (result.status === 'settled') {
          await editReplyV2(
            interaction,
            renderBlackjackGame(result.game, { balance: result.balance, resultText: result.resultText }),
            { ephemeral: true },
          );
          return;
        }
        if (result.status === 'expired') {
          await editReplyV2(interaction, `A partida anterior expirou; a aposta foi devolvida. Saldo: **${formatYen(result.balance)}**.`, { ephemeral: true });
          return;
        }
        if (result.status === 'active_game') {
          await editReplyV2(interaction, 'Você já tem outra partida em andamento. Conclua-a ou aguarde o prazo de expiração.', { ephemeral: true });
          return;
        }
        if (result.status === 'transfer_pending') {
          await editReplyV2(interaction, 'Uma transferência está sendo finalizada. Tente novamente em instantes.', { ephemeral: true });
          return;
        }
        await editReplyV2(interaction, 'Saldo insuficiente para essa aposta.', { ephemeral: true });
        return;
      }

      const result = await playInstantGame(context.database, {
        userId: interaction.user.id,
        gameName,
        stake,
        betType: interaction.options.getString('tipo'),
        selectedNumber: interaction.options.getInteger('numero'),
        coinChoice: interaction.options.getString('lado'),
      });
      if (result.status === 'active_game') {
        await editReplyV2(interaction, 'Você já tem uma partida interativa em andamento. Conclua-a ou aguarde o prazo de expiração.', { ephemeral: true });
        return;
      }
      if (result.status === 'insufficient_balance') {
        await editReplyV2(interaction, 'Saldo insuficiente para essa aposta.', { ephemeral: true });
        return;
      }
      if (result.status === 'transfer_pending') {
        await editReplyV2(interaction, 'Uma transferência está sendo finalizada. Tente novamente em instantes.', { ephemeral: true });
        return;
      }
      await editReplyV2(interaction, result.message, { ephemeral: true });
    } catch (error) {
      const messages = {
        ECONOMY_DISABLED: 'O sistema de economia está desativado no painel.',
        GAME_DISABLED: 'Este jogo está desativado no painel.',
        INVALID_BET: 'A aposta está fora dos limites configurados no painel.',
        BLACKJACK_EVEN_BET_REQUIRED: 'No blackjack, a aposta precisa ser um valor par para pagar corretamente o prêmio natural de 3:2 em Yen inteiro.',
        BET_REQUIRED: 'Informe o valor da aposta para iniciar o blackjack. Se já houver uma partida, use o comando sem valor para retomá-la.',
        PAYOUT_LIMIT_REACHED: 'Esse resultado ultrapassaria o limite de pagamento configurado.',
        ROULETTE_NUMBER_REQUIRED: 'Para apostar em número exato, informe um número de 0 a 36.',
        TRANSFER_PENDING: 'Uma transferência está sendo finalizada. Tente novamente em instantes.',
      };
      if (!messages[error.message]) {
        throw error;
      }
      await editReplyV2(interaction, messages[error.message], { ephemeral: true });
    }
  },
};
