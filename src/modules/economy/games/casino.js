import { randomInt } from 'node:crypto';
import { SLOT_SYMBOLS } from '../../../config/defaults.js';

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const ROULETTE_BET_TYPES = Object.freeze([
  { name: 'Número exato', value: 'number' },
  { name: 'Vermelho', value: 'red' },
  { name: 'Preto', value: 'black' },
  { name: 'Par', value: 'even' },
  { name: 'Ímpar', value: 'odd' },
  { name: 'Baixo (1–18)', value: 'low' },
  { name: 'Alto (19–36)', value: 'high' },
  { name: 'Dúzia 1 (1–12)', value: 'dozen1' },
  { name: 'Dúzia 2 (13–24)', value: 'dozen2' },
  { name: 'Dúzia 3 (25–36)', value: 'dozen3' },
]);

export function rouletteColor(number) {
  if (number === 0) {
    return 'verde';
  }
  return RED_NUMBERS.has(number) ? 'vermelho' : 'preto';
}

export function resolveRouletteBet({ stake, betType, selectedNumber, spin }) {
  const color = rouletteColor(spin);
  let won = false;
  let multiplier = 0;

  if (betType === 'number') {
    won = spin === selectedNumber;
    multiplier = won ? 36 : 0;
  } else if (betType === 'red' || betType === 'black') {
    won = color === (betType === 'red' ? 'vermelho' : 'preto');
    multiplier = won ? 2 : 0;
  } else if (betType === 'even' || betType === 'odd') {
    won = spin !== 0 && (betType === 'even' ? spin % 2 === 0 : spin % 2 === 1);
    multiplier = won ? 2 : 0;
  } else if (betType === 'low' || betType === 'high') {
    won = betType === 'low' ? spin >= 1 && spin <= 18 : spin >= 19 && spin <= 36;
    multiplier = won ? 2 : 0;
  } else if (/^dozen[1-3]$/.test(betType)) {
    const dozen = Number(betType.slice(-1));
    const lower = (dozen - 1) * 12 + 1;
    won = spin >= lower && spin <= lower + 11;
    multiplier = won ? 3 : 0;
  } else {
    throw new Error('INVALID_ROULETTE_BET');
  }

  const payout = stake * multiplier;
  return { spin, color, won, payout, betType, selectedNumber };
}

export function spinEuropeanRoulette({ stake, betType, selectedNumber }) {
  const spin = randomInt(0, 37);
  return resolveRouletteBet({ stake, betType, selectedNumber, spin });
}

function randomSlotSymbol() {
  const roll = randomInt(0, 100);
  let cumulative = 0;
  for (const item of SLOT_SYMBOLS) {
    cumulative += item.weight;
    if (roll < cumulative) {
      return item.symbol;
    }
  }
  return SLOT_SYMBOLS.at(-1).symbol;
}

export function spinSlots(stake, payouts) {
  const symbols = [randomSlotSymbol(), randomSlotSymbol(), randomSlotSymbol()];
  const combination = symbols.join('');
  const multiplier = payouts[combination] ?? 0;
  return {
    symbols,
    combination,
    multiplier,
    payout: stake * multiplier,
  };
}

export function flipCoin(choice) {
  if (!['cara', 'coroa'].includes(choice)) {
    throw new Error('INVALID_COIN_SIDE');
  }
  const result = randomInt(0, 2) === 0 ? 'cara' : 'coroa';
  const won = result === choice;
  return { choice, result, won };
}

export function rollDuelDice() {
  const playerRoll = randomInt(1, 21);
  const houseRoll = randomInt(1, 21);
  const outcome = playerRoll > houseRoll ? 'win' : playerRoll < houseRoll ? 'loss' : 'push';
  return { playerRoll, houseRoll, outcome };
}
