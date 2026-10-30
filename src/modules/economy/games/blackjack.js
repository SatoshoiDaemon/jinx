import { randomInt, randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);

function newDeck() {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

export function scoreBlackjackHand(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') {
      total += 11;
      aces += 1;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

function isNatural(hand) {
  return hand.length === 2 && scoreBlackjackHand(hand).total === 21;
}

function draw(game) {
  const [card, ...deck] = game.deck;
  return { card, deck };
}

function dealerPlay(game) {
  const dealerHand = [...game.dealerHand];
  let deck = [...game.deck];
  while (scoreBlackjackHand(dealerHand).total < 17) {
    const [card, ...remaining] = deck;
    dealerHand.push(card);
    deck = remaining;
  }
  return { ...game, dealerHand, deck };
}

function settleResult(game, stake, { natural = false } = {}) {
  const playerTotal = scoreBlackjackHand(game.playerHand).total;
  const dealerTotal = scoreBlackjackHand(game.dealerHand).total;
  let outcome;
  let payout;

  if (playerTotal > 21) {
    outcome = 'loss';
    payout = 0;
  } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
    outcome = natural ? 'blackjack' : 'win';
    payout = natural ? stake + (stake / 2) + stake : stake * 2;
  } else if (playerTotal === dealerTotal) {
    outcome = 'push';
    payout = stake;
  } else {
    outcome = 'loss';
    payout = 0;
  }

  return {
    ...game,
    status: 'settling',
    outcome,
    payout,
    playerTotal,
    dealerTotal,
  };
}

export function createBlackjackGame({ userId, stake, timeoutSeconds, now = new Date() }) {
  const deck = newDeck();
  const game = {
    id: randomUUID(),
    kind: 'blackjack',
    ownerId: userId,
    stake,
    status: 'playing',
    version: 0,
    deck: deck.slice(4),
    playerHand: [deck[0], deck[2]],
    dealerHand: [deck[1], deck[3]],
    createdAt: now,
    expiresAt: new Date(now.getTime() + timeoutSeconds * 1000),
  };

  const playerNatural = isNatural(game.playerHand);
  const dealerNatural = isNatural(game.dealerHand);
  if (playerNatural || dealerNatural) {
    const revealed = { ...game, dealerRevealed: true };
    if (playerNatural && dealerNatural) {
      return { ...revealed, status: 'settling', outcome: 'push', payout: stake };
    }
    if (playerNatural) {
      return { ...revealed, status: 'settling', outcome: 'blackjack', payout: stake + (stake / 2) + stake };
    }
    return { ...revealed, status: 'settling', outcome: 'loss', payout: 0 };
  }
  return game;
}

export function advanceBlackjackGame(game, action) {
  if (!game || game.status !== 'playing' || !['hit', 'stand'].includes(action)) {
    throw new Error('INVALID_BLACKJACK_ACTION');
  }

  let updated = { ...game, version: game.version + 1 };
  if (action === 'hit') {
    const drawn = draw(updated);
    updated = {
      ...updated,
      deck: drawn.deck,
      playerHand: [...updated.playerHand, drawn.card],
    };
    const score = scoreBlackjackHand(updated.playerHand);
    if (score.total < 21) {
      return updated;
    }
    if (score.total === 21) {
      updated = dealerPlay(updated);
      return { ...settleResult(updated, game.stake), dealerRevealed: true };
    }
    return {
      ...updated,
      status: 'settling',
      outcome: 'loss',
      payout: 0,
      playerTotal: score.total,
      dealerTotal: scoreBlackjackHand(updated.dealerHand).total,
      dealerRevealed: true,
    };
  }

  updated = dealerPlay(updated);
  return { ...settleResult(updated, game.stake), dealerRevealed: true };
}

function cardsText(hand) {
  return hand.map((card) => `${card.rank}${card.suit}`).join(' ');
}

export function renderBlackjackGame(game, { balance, resultText } = {}) {
  const playerTotal = scoreBlackjackHand(game.playerHand).total;
  const dealerCards = game.dealerRevealed
    ? cardsText(game.dealerHand)
    : `${cardsText([game.dealerHand[0]])} ??`;
  const dealerScore = game.dealerRevealed
    ? scoreBlackjackHand(game.dealerHand).total
    : scoreBlackjackHand([game.dealerHand[0]]).total;
  const lines = [
    '## Blackjack',
    '',
    `Aposta: **¥${new Intl.NumberFormat('pt-BR').format(game.stake)}**`,
    `Sua mão: **${cardsText(game.playerHand)}** — **${playerTotal}**`,
    `Dealer: **${dealerCards}** — ${game.dealerRevealed ? `**${dealerScore}**` : `**${dealerScore}+?**`}`,
  ];
  if (resultText) {
    lines.push('', resultText);
  }
  if (balance !== undefined) {
    lines.push(`Saldo atual: **¥${new Intl.NumberFormat('pt-BR').format(balance)}**`);
  }
  if (game.status === 'playing') {
    lines.push('', `Você pode comprar ou parar. Natural paga 3:2; vitória comum, 1:1; empate devolve a aposta. O dealer para em 17, incluindo soft 17. A partida expira às ${new Date(game.expiresAt).toLocaleTimeString('pt-BR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })} UTC.`);
  }
  return lines.join('\n');
}

export function buildBlackjackRows(game) {
  if (game.status !== 'playing') {
    return [];
  }
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`economy:blackjack:${game.id}:${game.version}:hit`)
      .setLabel('Comprar carta')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`economy:blackjack:${game.id}:${game.version}:stand`)
      .setLabel('Parar')
      .setStyle(ButtonStyle.Secondary),
  )];
}

export function blackjackResultText(game, payout, balance) {
  const amount = new Intl.NumberFormat('pt-BR').format(payout);
  const net = payout - game.stake;
  const netText = net > 0 ? `Lucro: **¥${new Intl.NumberFormat('pt-BR').format(net)}**.`
    : net < 0 ? `Perda: **¥${new Intl.NumberFormat('pt-BR').format(Math.abs(net))}**.`
      : 'Aposta devolvida.';
  const outcome = game.outcome === 'blackjack'
    ? 'Blackjack natural: pagamento de 3:2.'
    : game.outcome === 'win'
      ? 'Você venceu: pagamento de 1:1.'
      : game.outcome === 'push'
        ? 'Empate: aposta devolvida.'
        : 'Você perdeu a aposta.';
  return `${outcome}\nRetorno: **¥${amount}**. ${netText}\nSaldo: **¥${new Intl.NumberFormat('pt-BR').format(balance)}**.`;
}
