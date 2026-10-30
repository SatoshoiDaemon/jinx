import {
  DEFAULT_ECONOMY_SETTINGS,
  SLOT_SYMBOLS,
} from '../../config/defaults.js';
import { getModuleConfig } from '../../models/bot-config.js';

export const MAX_WALLET_BALANCE = Number.MAX_SAFE_INTEGER;
export const MAX_ECONOMY_INPUT = 1_000_000_000;
export const MAX_ECONOMY_PAYOUT = 1_000_000_000_000;
export const MAX_GAME_MULTIPLIER = 100;
export const GAME_TIMEOUT_MIN_SECONDS = 60;
export const GAME_TIMEOUT_MAX_SECONDS = 3600;

const MAX_COOLDOWN_SECONDS = 2_592_000;
const DEFAULT_SLOT_PAYOUTS = DEFAULT_ECONOMY_SETTINGS.games.slots.payouts;
const ALLOWED_SLOT_COMBINATIONS = new Set(SLOT_SYMBOLS.map(({ symbol }) => symbol.repeat(3)));

function requireInteger(value, minimum, maximum, setting) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('ECONOMY_CONFIGURATION_INVALID');
  }
  return value;
}

function requireBoolean(value) {
  if (typeof value !== 'boolean') {
    throw new Error('ECONOMY_CONFIGURATION_INVALID');
  }
  return value;
}

export function validateEconomySettings(settings) {
  const dailyReward = requireInteger(settings.daily?.reward, 1, MAX_ECONOMY_INPUT, 'daily.reward');
  const streak = settings.daily?.streak ?? {};
  const bonusPerDay = requireInteger(streak.bonusPerDay, 0, MAX_ECONOMY_INPUT, 'daily.streak.bonusPerDay');
  const maxBonus = requireInteger(streak.maxBonus, 0, MAX_ECONOMY_INPUT, 'daily.streak.maxBonus');
  const maxDays = requireInteger(streak.maxDays, 1, 365, 'daily.streak.maxDays');
  const workMin = requireInteger(settings.work?.minReward, 1, MAX_ECONOMY_INPUT, 'work.minReward');
  const workMax = requireInteger(settings.work?.maxReward, workMin, MAX_ECONOMY_INPUT, 'work.maxReward');
  const crimeMin = requireInteger(settings.crime?.minReward, 1, MAX_ECONOMY_INPUT, 'crime.minReward');
  const crimeMax = requireInteger(settings.crime?.maxReward, crimeMin, MAX_ECONOMY_INPUT, 'crime.maxReward');
  const fineMin = requireInteger(settings.crime?.minFine, 1, MAX_ECONOMY_INPUT, 'crime.minFine');
  const fineMax = requireInteger(settings.crime?.maxFine, fineMin, MAX_ECONOMY_INPUT, 'crime.maxFine');
  const transferMin = requireInteger(settings.transfer?.minAmount, 1, MAX_ECONOMY_INPUT, 'transfer.minAmount');
  const transferMax = requireInteger(settings.transfer?.maxAmount, transferMin, MAX_ECONOMY_INPUT, 'transfer.maxAmount');
  const minBet = requireInteger(settings.games?.minBet, 1, 10_000_000, 'games.minBet');
  const maxBet = requireInteger(settings.games?.maxBet, minBet, 10_000_000, 'games.maxBet');
  const maxPayout = requireInteger(settings.games?.maxPayout, maxBet * MAX_GAME_MULTIPLIER, MAX_ECONOMY_PAYOUT, 'games.maxPayout');
  const timeoutSeconds = requireInteger(
    settings.games?.timeoutSeconds,
    GAME_TIMEOUT_MIN_SECONDS,
    GAME_TIMEOUT_MAX_SECONDS,
    'games.timeoutSeconds',
  );
  const crimeChance = requireInteger(settings.crime?.successChancePercent, 0, 100, 'crime.successChancePercent');
  const dailyCooldownHours = requireInteger(settings.daily?.cooldownHours, 1, 168, 'daily.cooldownHours');
  const workCooldownSeconds = requireInteger(settings.work?.cooldownSeconds, 1, MAX_COOLDOWN_SECONDS, 'work.cooldownSeconds');
  const crimeCooldownSeconds = requireInteger(settings.crime?.cooldownSeconds, 1, MAX_COOLDOWN_SECONDS, 'crime.cooldownSeconds');
  const startingBalance = requireInteger(settings.startingBalance, 0, MAX_ECONOMY_INPUT, 'startingBalance');

  if (!Number.isSafeInteger(dailyReward + maxBonus)) {
    throw new Error('ECONOMY_CONFIGURATION_INVALID');
  }

  const slots = settings.games?.slots ?? {};
  const configuredPayouts = slots.payouts && typeof slots.payouts === 'object' && !Array.isArray(slots.payouts)
    ? slots.payouts
    : {};
  const payouts = { ...DEFAULT_SLOT_PAYOUTS };
  for (const [combination, multiplier] of Object.entries(configuredPayouts)) {
    if (!ALLOWED_SLOT_COMBINATIONS.has(combination)) {
      throw new Error('ECONOMY_CONFIGURATION_INVALID');
    }
    payouts[combination] = requireInteger(multiplier, 0, MAX_GAME_MULTIPLIER, `games.slots.payouts.${combination}`);
  }
  if (Math.max(...Object.values(payouts)) * maxBet > maxPayout) {
    throw new Error('ECONOMY_CONFIGURATION_INVALID');
  }

  for (const gameName of ['blackjack', 'roulette', 'slots', 'coin', 'dice']) {
    requireBoolean(settings.games?.[gameName]?.enabled);
  }

  return {
    enabled: requireBoolean(settings.enabled),
    startingBalance,
    daily: {
      reward: dailyReward,
      cooldownHours: dailyCooldownHours,
      streak: {
        enabled: requireBoolean(streak.enabled),
        bonusPerDay,
        maxBonus,
        maxDays,
      },
    },
    work: {
      minReward: workMin,
      maxReward: workMax,
      cooldownSeconds: workCooldownSeconds,
    },
    crime: {
      successChancePercent: crimeChance,
      minReward: crimeMin,
      maxReward: crimeMax,
      minFine: fineMin,
      maxFine: fineMax,
      cooldownSeconds: crimeCooldownSeconds,
    },
    transfer: {
      minAmount: transferMin,
      maxAmount: transferMax,
    },
    games: {
      minBet,
      maxBet,
      maxPayout,
      timeoutSeconds,
      blackjack: { enabled: settings.games.blackjack.enabled },
      roulette: { enabled: settings.games.roulette.enabled },
      slots: { enabled: settings.games.slots.enabled, payouts },
      coin: { enabled: settings.games.coin.enabled },
      dice: { enabled: settings.games.dice.enabled },
    },
  };
}

function mergeEconomySettings(stored) {
  return {
    ...DEFAULT_ECONOMY_SETTINGS,
    ...stored,
    daily: {
      ...DEFAULT_ECONOMY_SETTINGS.daily,
      ...(stored.daily ?? {}),
      streak: {
        ...DEFAULT_ECONOMY_SETTINGS.daily.streak,
        ...(stored.daily?.streak ?? {}),
      },
    },
    work: { ...DEFAULT_ECONOMY_SETTINGS.work, ...(stored.work ?? {}) },
    crime: { ...DEFAULT_ECONOMY_SETTINGS.crime, ...(stored.crime ?? {}) },
    transfer: { ...DEFAULT_ECONOMY_SETTINGS.transfer, ...(stored.transfer ?? {}) },
    games: {
      ...DEFAULT_ECONOMY_SETTINGS.games,
      ...(stored.games ?? {}),
      blackjack: {
        ...DEFAULT_ECONOMY_SETTINGS.games.blackjack,
        ...(stored.games?.blackjack ?? {}),
      },
      roulette: {
        ...DEFAULT_ECONOMY_SETTINGS.games.roulette,
        ...(stored.games?.roulette ?? {}),
      },
      slots: {
        ...DEFAULT_ECONOMY_SETTINGS.games.slots,
        ...(stored.games?.slots ?? {}),
        payouts: {
          ...DEFAULT_SLOT_PAYOUTS,
          ...(stored.games?.slots?.payouts ?? {}),
        },
      },
      coin: {
        ...DEFAULT_ECONOMY_SETTINGS.games.coin,
        ...(stored.games?.coin ?? {}),
      },
      dice: {
        ...DEFAULT_ECONOMY_SETTINGS.games.dice,
        ...(stored.games?.dice ?? {}),
      },
    },
  };
}

export async function getEconomySettings(database) {
  const stored = await getModuleConfig(database, 'economy', DEFAULT_ECONOMY_SETTINGS);
  return validateEconomySettings(mergeEconomySettings(stored));
}
