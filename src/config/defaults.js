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
