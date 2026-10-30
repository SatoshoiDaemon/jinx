export const DEFAULT_LEVEL_SETTINGS = Object.freeze({
  xpBase: 100,
  xpStep: 25,
  xpMin: 5,
  xpMax: 15,
  cooldownSeconds: 60,
  maxBoostMultiplier: 5,
  roleBoosts: Object.freeze({}),
  channelBoosts: Object.freeze({}),
});

export const DEFAULT_WELCOME_SETTINGS = Object.freeze({
  initialRoles: Object.freeze({
    enabled: false,
    roleIds: Object.freeze([]),
  }),
  directMessage: Object.freeze({
    enabled: false,
    content: 'Olá, {user.mention}! Seja bem-vindo(a) ao {guild.name}. Você é nosso membro número {guild.memberCount}!',
  }),
  publicMessage: Object.freeze({
    enabled: false,
    channelId: null,
    content: '{user.mention} entrou no servidor. Boas-vindas!',
  }),
});

export const DEFAULT_VOICE_CALL_SETTINGS = Object.freeze({
  baseChannelId: null,
  categoryId: null,
});

export const SLOT_SYMBOLS = Object.freeze([
  Object.freeze({ symbol: '🍒', weight: 40 }),
  Object.freeze({ symbol: '🍋', weight: 25 }),
  Object.freeze({ symbol: '🍇', weight: 15 }),
  Object.freeze({ symbol: '🔔', weight: 10 }),
  Object.freeze({ symbol: '⭐', weight: 7 }),
  Object.freeze({ symbol: '💎', weight: 3 }),
]);

export const DEFAULT_ECONOMY_SETTINGS = Object.freeze({
  enabled: true,
  startingBalance: 100,
  daily: Object.freeze({
    reward: 100,
    cooldownHours: 24,
    streak: Object.freeze({
      enabled: false,
      bonusPerDay: 25,
      maxBonus: 250,
      maxDays: 10,
    }),
  }),
  work: Object.freeze({
    minReward: 50,
    maxReward: 150,
    cooldownSeconds: 3600,
  }),
  crime: Object.freeze({
    successChancePercent: 40,
    minReward: 100,
    maxReward: 400,
    minFine: 25,
    maxFine: 200,
    cooldownSeconds: 7200,
  }),
  transfer: Object.freeze({
    minAmount: 1,
    maxAmount: 100000,
  }),
  games: Object.freeze({
    minBet: 10,
    maxBet: 10000,
    maxPayout: 1000000,
    timeoutSeconds: 300,
    blackjack: Object.freeze({ enabled: true }),
    roulette: Object.freeze({ enabled: true }),
    slots: Object.freeze({
      enabled: true,
      payouts: Object.freeze({
        '🍒🍒🍒': 3,
        '🍋🍋🍋': 4,
        '🍇🍇🍇': 6,
        '🔔🔔🔔': 10,
        '⭐⭐⭐': 20,
        '💎💎💎': 50,
      }),
    }),
    coin: Object.freeze({ enabled: true }),
    dice: Object.freeze({ enabled: true }),
  }),
});

export const BOT_CONFIG_ID = 'jinx:config';
export const BOT_CONFIG_COLLECTION = 'bot_config';

export const DICE_LIMITS = Object.freeze({
  maxDice: 100,
  maxFaces: 1000,
  maxModifier: 10000,
});

export const COMMAND_LIMITS = Object.freeze({
  maxChooseLength: 1000,
});
