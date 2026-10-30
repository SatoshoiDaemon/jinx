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
