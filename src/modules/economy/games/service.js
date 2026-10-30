import { randomUUID } from 'node:crypto';
import { editReplyV2 } from '../../common/components-v2.js';
import {
  finishPendingWager,
  formatYen,
  reserveWager,
  settleWager,
} from '../service.js';
import {
  ensureWallet,
  getWallet,
} from '../repository.js';
import { getEconomySettings } from '../config.js';
import {
  flipCoin,
  resolveRouletteBet,
  rollDuelDice,
  rouletteColor,
  spinEuropeanRoulette,
  spinSlots,
} from './casino.js';
import {
  advanceBlackjackGame,
  blackjackResultText,
  buildBlackjackRows,
  createBlackjackGame,
  renderBlackjackGame,
} from './blackjack.js';
import {
  expireActiveGame,
  settleActiveGame,
  updateActiveGame,
} from '../repository.js';

function assertBet(settings, stake) {
  if (!Number.isSafeInteger(stake) || stake < settings.games.minBet || stake > settings.games.maxBet) {
    throw new Error('INVALID_BET');
  }
}

async function currentGame(database, userId, settings) {
  let wallet = await ensureWallet(database, userId, settings.startingBalance);
  if (wallet.activeGame?.status === 'settling') {
    await finishPendingWager(database, userId, wallet);
    wallet = await getWallet(database, userId);
  }
  return wallet;
}

export async function createOrResumeBlackjack(database, userId, stake) {
  const settings = await getEconomySettings(database);
  if (!settings.enabled) {
    throw new Error('ECONOMY_DISABLED');
  }
  if (!settings.games.blackjack.enabled) {
    throw new Error('GAME_DISABLED');
  }
  const wallet = await currentGame(database, userId, settings);
  if (wallet.activeGame?.status === 'playing') {
    if (wallet.activeGame.expiresAt <= new Date()) {
      await expireActiveGame(database, userId, wallet.activeGame.id);
      return { status: 'expired', balance: (await getWallet(database, userId))?.balance };
    }
    if (wallet.activeGame.kind !== 'blackjack') {
      return { status: 'active_game', game: wallet.activeGame };
    }
    return { status: 'resume', game: wallet.activeGame, balance: wallet.balance };
  }
  if (stake === undefined || stake === null) {
    throw new Error('BET_REQUIRED');
  }
  if (!Number.isSafeInteger(stake) || stake < settings.games.minBet || stake > settings.games.maxBet) {
    throw new Error('INVALID_BET');
  }
  if (stake % 2 !== 0) {
    throw new Error('BLACKJACK_EVEN_BET_REQUIRED');
  }

  const game = createBlackjackGame({
    userId,
    stake,
    timeoutSeconds: settings.games.timeoutSeconds,
  });
  if (game.payout !== undefined && game.payout > settings.games.maxPayout) {
    throw new Error('PAYOUT_LIMIT_REACHED');
  }
  const reservation = await reserveWager(database, userId, game);
  if (reservation.status !== 'reserved') {
    return { status: reservation.status, wallet: reservation.wallet };
  }
  if (game.status === 'settling') {
    await settleWager(database, userId, game.id);
    const updated = await getWallet(database, userId);
    if (updated?.activeGame?.id === game.id) {
      return { status: 'settling', game, balance: updated.balance };
    }
    const resultText = blackjackResultText(game, game.payout, updated.balance);
    return { status: 'settled', game: { ...game, dealerRevealed: true }, balance: updated.balance, resultText };
  }
  return { status: 'playing', game, balance: reservation.wallet.balance };
}

function chooseStatus(payout, stake) {
  if (payout > stake) {
    return 'win';
  }
  if (payout === stake) {
    return 'push';
  }
  return 'loss';
}

function rouletteDescription(result, betType, selectedNumber) {
  const picked = betType === 'number' ? `no número **${selectedNumber}**` : `em **${betType}**`;
  const outcomeText = result.payout > 0
    ? `Aposta vencedora; retorno total **${result.payout}× a aposta indicada pela regra**.`
    : 'Aposta perdida.';
  return `Roleta europeia: saiu **${result.spin} (${result.color})**. Você apostou ${picked}. ${outcomeText}`;
}

function renderInstantResult(game, balance) {
  const payout = game.payout;
  const net = payout - game.stake;
  const outcomeText = game.outcome === 'win'
    ? `Vitória. Retorno: **${formatYen(payout)}**; lucro: **${formatYen(net)}**.`
    : game.outcome === 'push'
      ? `Empate. Sua aposta voltou: **${formatYen(payout)}**.`
      : `Derrota. Perda: **${formatYen(game.stake)}**.`;
  return [
    `## ${game.title}`,
    '',
    `Aposta: **${formatYen(game.stake)}**`,
    game.description,
    outcomeText,
    `Saldo atual: **${formatYen(balance)}**`,
  ].join('\n');
}

function createInstantGame({ userId, gameName, stake, result, description, now = new Date() }) {
  return {
    id: randomUUID(),
    kind: gameName,
    ownerId: userId,
    stake,
    status: 'settling',
    outcome: result.outcome,
    payout: result.payout,
    data: result.data,
    title: result.title,
    description,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  };
}

export async function playInstantGame(database, {
  userId,
  gameName,
  stake,
  betType,
  selectedNumber,
  coinChoice,
}) {
  const settings = await getEconomySettings(database);
  if (!settings.enabled) {
    throw new Error('ECONOMY_DISABLED');
  }
  if (!settings.games[gameName]?.enabled) {
    throw new Error('GAME_DISABLED');
  }
  assertBet(settings, stake);

  const wallet = await currentGame(database, userId, settings);
  if (wallet.activeGame?.status === 'playing') {
    return { status: 'active_game', wallet, game: wallet.activeGame };
  }

  let result;
  let description;
  if (gameName === 'roulette') {
    if (betType === 'number' && (!Number.isSafeInteger(selectedNumber) || selectedNumber < 0 || selectedNumber > 36)) {
      throw new Error('ROULETTE_NUMBER_REQUIRED');
    }
    const spin = spinEuropeanRoulette({ stake, betType, selectedNumber });
    result = {
      outcome: chooseStatus(spin.payout, stake),
      payout: spin.payout,
      data: spin,
      title: 'Roleta europeia',
    };
    const betNames = {
      red: 'vermelho', black: 'preto', even: 'par', odd: 'ímpar',
      low: 'baixo (1–18)', high: 'alto (19–36)',
      dozen1: 'dúzia 1 (1–12)', dozen2: 'dúzia 2 (13–24)', dozen3: 'dúzia 3 (25–36)',
    };
    const selected = betType === 'number'
      ? `no número **${selectedNumber}**`
      : `em **${betNames[betType]}**`;
    const rule = betType === 'number'
      ? '35:1 de lucro (retorno bruto 36×)'
      : betType.startsWith('dozen')
        ? '2:1 de lucro (retorno bruto 3×)'
        : '1:1 de lucro (retorno bruto 2×)';
    description = `Saiu **${spin.spin} (${spin.color})**. Aposta ${selected}; regra: **${rule}**. ${spin.payout > 0 ? `Retorno bruto de **${spin.payout / stake}×**.` : 'A aposta perdeu.'}`;
  } else if (gameName === 'slots') {
    const spin = spinSlots(stake, settings.games.slots.payouts);
    result = {
      outcome: chooseStatus(spin.payout, stake),
      payout: spin.payout,
      data: spin,
      title: 'Caça-níquel',
    };
    const payoutTable = Object.entries(settings.games.slots.payouts)
      .map(([combination, multiplier]) => `${combination} ${multiplier > 0 ? `${multiplier}×` : 'sem retorno'}`)
      .join(' · ');
    description = `Resultado: **${spin.symbols.join(' | ')}**. Retorno desta combinação: **${spin.multiplier}× bruto**. Trincas pagas: ${payoutTable}. Chance por posição: 🍒 40%, 🍋 25%, 🍇 15%, 🔔 10%, ⭐ 7%, 💎 3%.`;
  } else if (gameName === 'coin') {
    const flip = flipCoin(coinChoice);
    const payout = flip.won ? stake * 2 : 0;
    result = {
      outcome: chooseStatus(payout, stake),
      payout,
      data: flip,
      title: 'Cara ou coroa',
    };
    description = `Você escolheu **${coinChoice}**; saiu **${flip.result}**. Vitória paga 1:1 (retorno total de 2×).`;
  } else if (gameName === 'dice') {
    const duel = rollDuelDice();
    const payout = duel.outcome === 'win' ? stake * 2 : duel.outcome === 'push' ? stake : 0;
    result = {
      outcome: duel.outcome,
      payout,
      data: duel,
      title: 'Duelo de dados',
    };
    description = `Seu d20: **${duel.playerRoll}**; d20 da casa: **${duel.houseRoll}**. Maior resultado vence; empate devolve a aposta. Vitória paga 1:1.`;
  } else {
    throw new Error('UNKNOWN_GAME');
  }

  if (result.payout > settings.games.maxPayout) {
    throw new Error('PAYOUT_LIMIT_REACHED');
  }
  const game = createInstantGame({
    userId,
    gameName,
    stake,
    result,
    description,
  });
  const reservation = await reserveWager(database, userId, game);
  if (reservation.status !== 'reserved') {
    return { status: reservation.status, wallet: reservation.wallet, game: reservation.wallet?.activeGame };
  }
  await settleWager(database, userId, game.id);
  const updated = await getWallet(database, userId);
  const settled = updated?.activeGame?.id !== game.id;
  const message = settled
    ? renderInstantResult(game, updated?.balance ?? reservation.wallet.balance)
    : `## ${game.title}\n\n${game.description}\n\nO resultado está registrado; o pagamento de ${formatYen(game.payout)} aguarda uma transferência pendente. Será aplicado automaticamente.`;
  return {
    status: settled ? 'settled' : 'settling',
    game: { ...game, balance: updated?.balance },
    message,
  };
}

export async function handleBlackjackAction(interaction, context, match) {
  const [, gameId, versionText, action] = match;
  if (!['hit', 'stand'].includes(action)) {
    return false;
  }
  await interaction.deferUpdate();
  const userId = interaction.user.id;
  const wallet = await getWallet(context.database, userId);
  const game = wallet?.activeGame;
  if (!game || game.id !== gameId || game.kind !== 'blackjack') {
    await editReplyV2(interaction, 'Esta partida já foi resolvida ou expirou.');
    return true;
  }

  const version = Number(versionText);
  if (game.ownerId !== userId) {
    await editReplyV2(interaction, 'Esta partida pertence a outra pessoa.');
    return true;
  }
  if (game.expiresAt <= new Date()) {
    const expired = await expireActiveGame(context.database, userId, gameId);
    const updated = await getWallet(context.database, userId);
    const text = expired.status === 'refunded'
      ? `## Blackjack expirado\n\nA partida foi encerrada por inatividade e a aposta de **${formatYen(expired.amount)}** foi devolvida.\nSaldo atual: **${formatYen(updated.balance)}**.`
      : 'Esta partida já foi encerrada.';
    await editReplyV2(interaction, text);
    return true;
  }
  if (game.version !== version) {
    await editReplyV2(
      interaction,
      renderBlackjackGame(game, { balance: wallet.balance, resultText: 'Essa ação já foi processada. Use os controles atuais.' }),
      { rows: buildBlackjackRows(game) },
    );
    return true;
  }

  const updatedGame = advanceBlackjackGame(game, action);
  const updated = await updateActiveGame(context.database, {
    userId,
    gameId,
    version,
    game: updatedGame,
  });
  if (!updated) {
    const latest = await getWallet(context.database, userId);
    if (latest?.activeGame?.id === gameId && latest.activeGame.status === 'playing') {
      if (latest.activeGame.expiresAt <= new Date()) {
        const expired = await expireActiveGame(context.database, userId, gameId);
        const finalWallet = await getWallet(context.database, userId);
        const text = expired.status === 'refunded'
          ? `## Blackjack expirado\n\nA partida expirou e a aposta de **${formatYen(expired.amount)}** foi devolvida.\nSaldo atual: **${formatYen(finalWallet.balance)}**.`
          : 'Esta partida já foi encerrada.';
        await editReplyV2(interaction, text);
      } else {
        await editReplyV2(
          interaction,
          renderBlackjackGame(latest.activeGame, { balance: latest.balance, resultText: 'Essa ação já foi processada. Use os controles atuais.' }),
          { rows: buildBlackjackRows(latest.activeGame) },
        );
      }
    } else {
      await editReplyV2(interaction, 'Esta partida já foi resolvida.');
    }
    return true;
  }

  if (updatedGame.status === 'settling') {
    await settleActiveGame(context.database, userId, gameId);
    const latest = await getWallet(context.database, userId);
    if (latest?.activeGame?.id === gameId) {
      await editReplyV2(
        interaction,
        renderBlackjackGame(
          { ...updatedGame, dealerRevealed: true },
          {
            balance: latest.balance,
            resultText: `Resultado registrado. O pagamento de ${formatYen(updatedGame.payout)} aguarda uma transferência pendente e será aplicado automaticamente.`,
          },
        ),
      );
      return true;
    }
    const resultText = blackjackResultText(updatedGame, updatedGame.payout, latest.balance);
    const finalGame = { ...updatedGame, dealerRevealed: true };
    await editReplyV2(interaction, renderBlackjackGame(finalGame, { balance: latest.balance, resultText }));
    return true;
  }

  const latest = await getWallet(context.database, userId);
  await editReplyV2(
    interaction,
    renderBlackjackGame(updatedGame, { balance: latest.balance }),
    { rows: buildBlackjackRows(updatedGame) },
  );
  return true;
}

export function rouletteColorName(number) {
  return rouletteColor(number);
}

export { resolveRouletteBet };
