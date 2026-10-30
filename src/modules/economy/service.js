import { randomInt } from 'node:crypto';
import { DEFAULT_ECONOMY_SETTINGS } from '../../config/defaults.js';
import { formatDuration } from '../common/format.js';
import { getEconomySettings } from './config.js';
import {
  adjustWalletByAdmin,
  claimCrime,
  claimDaily,
  claimWork,
  ensureWallet,
  ensureWallets,
  getWallet,
  reserveGame,
  settleActiveGame,
} from './repository.js';
import { transferYen as transferYenRepository } from './transfers.js';

const WORK_REPLIES = Object.freeze([
  'organizou o estoque da loja de conveniência',
  'entregou pedidos pela cidade',
  'cuidou do jardim de um vizinho',
  'ajudou a montar um festival local',
  'revisou uma pilha de documentos',
  'ensinou uma receita para um iniciante',
  'consertou bicicletas no parque',
  'passeou com os cães do bairro',
  'serviu chá em uma casa de chá',
  'pintou placas para uma feira',
  'ajudou a organizar a biblioteca',
  'preparou caixas para uma mudança',
  'fotografou um evento comunitário',
  'limpou mesas depois de um torneio',
  'fez inventário em uma papelaria',
]);

const CRIME_SUCCESS_REPLIES = Object.freeze([
  'conseguiu escapar com o plano fictício e encontrou',
  'concluiu o golpe imaginário sem ser reconhecido e levou',
  'vendeu um mapa do tesouro falso para um personagem distraído e recebeu',
  'invadiu o cofre de brinquedo da história e saiu com',
  'trocou etiquetas em uma feira fictícia e embolsou',
]);

const CRIME_FAILURE_REPLIES = Object.freeze([
  'foi descoberto no meio do plano fictício e pagou',
  'perdeu a corrida da história e arcou com',
  'deixou pistas demais no golpe imaginário e pagou',
  'foi parado pela guarda fictícia e recebeu uma multa de',
  'o plano saiu errado e custou',
]);

export function formatYen(amount) {
  return `¥${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(amount)}`;
}

export function formatCooldown(remainingMs) {
  return formatDuration(Math.ceil(Math.max(0, remainingMs) / 1000));
}

function randomArrayIndex(length) {
  return randomInt(0, length);
}

function chooseWorkReply(recentIds = []) {
  const recent = new Set(recentIds);
  const available = WORK_REPLIES
    .map((_, index) => index)
    .filter((index) => !recent.has(index));
  const choices = available.length ? available : WORK_REPLIES.map((_, index) => index);
  return choices[randomArrayIndex(choices.length)];
}

function chooseNarrative(replies) {
  return replies[randomArrayIndex(replies.length)];
}

function requireEnabled(settings) {
  if (!settings.enabled) {
    throw new Error('ECONOMY_DISABLED');
  }
}

export async function initializeEconomyWalletsForMembers(members, context) {
  const settings = await getEconomySettings(context.database);
  const userIds = [...members.values()]
    .filter((member) => member.guild.id === context.guildId && !member.user.bot)
    .map((member) => member.id);
  await ensureWallets(context.database, userIds, settings.startingBalance);
}

export async function initializeEconomyWalletForMember(member, context) {
  if (member.guild.id !== context.guildId || member.user.bot) {
    return null;
  }
  const settings = await getEconomySettings(context.database);
  return ensureWallet(context.database, member.id, settings.startingBalance);
}

export async function readWallet(database, userId) {
  const settings = await getEconomySettings(database);
  return ensureWallet(database, userId, settings.startingBalance);
}

export async function claimDailyReward(database, userId, now = new Date()) {
  const settings = await getEconomySettings(database);
  requireEnabled(settings);
  return claimDaily(database, { userId, settings, now });
}

export async function workForYen(database, userId, now = new Date()) {
  const settings = await getEconomySettings(database);
  requireEnabled(settings);
  const wallet = await ensureWallet(database, userId, settings.startingBalance, now);
  const replyId = chooseWorkReply(wallet.recentWorkReplyIds ?? []);
  const reward = randomInt(settings.work.minReward, settings.work.maxReward + 1);
  const result = await claimWork(database, { userId, settings, reward, replyId, now });
  return { ...result, narrative: WORK_REPLIES[replyId] };
}

export async function commitFictionalCrime(database, userId, now = new Date()) {
  const settings = await getEconomySettings(database);
  requireEnabled(settings);
  const success = randomInt(0, 100) < settings.crime.successChancePercent;
  const amount = success
    ? randomInt(settings.crime.minReward, settings.crime.maxReward + 1)
    : randomInt(settings.crime.minFine, settings.crime.maxFine + 1);
  const result = await claimCrime(database, { userId, settings, success, amount, now });
  return {
    ...result,
    narrative: chooseNarrative(success ? CRIME_SUCCESS_REPLIES : CRIME_FAILURE_REPLIES),
    successChancePercent: settings.crime.successChancePercent,
    minReward: settings.crime.minReward,
    maxReward: settings.crime.maxReward,
    minFine: settings.crime.minFine,
    maxFine: settings.crime.maxFine,
  };
}

export async function adjustYenByAdmin(database, {
  userId,
  adminId,
  direction,
  amount,
  now = new Date(),
}) {
  const settings = await getEconomySettings(database);
  requireEnabled(settings);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000) {
    throw new Error('INVALID_ECONOMY_AMOUNT');
  }
  return adjustWalletByAdmin(database, {
    userId,
    adminId,
    direction,
    amount,
    startingBalance: settings.startingBalance,
    now,
  });
}

export async function transferYen(client, database, {
  operationId,
  fromUserId,
  toUserId,
  amount,
  now = new Date(),
}) {
  const settings = await getEconomySettings(database);
  requireEnabled(settings);
  if (
    !Number.isSafeInteger(amount)
    || amount < settings.transfer.minAmount
    || amount > settings.transfer.maxAmount
  ) {
    throw new Error('INVALID_TRANSFER_AMOUNT');
  }
  return transferYenRepository(client, database, {
    operationId,
    fromUserId,
    toUserId,
    amount,
    startingBalance: settings.startingBalance,
    now,
  });
}

export async function currentEconomyConfig(database) {
  return getEconomySettings(database);
}

export function gameFeature(settings, gameName) {
  return settings.games[gameName]?.enabled === true;
}

export async function reserveWager(database, userId, game) {
  const settings = await getEconomySettings(database);
  requireEnabled(settings);
  if (!gameFeature(settings, game.kind)) {
    throw new Error('GAME_DISABLED');
  }
  if (
    !Number.isSafeInteger(game.stake)
    || game.stake < settings.games.minBet
    || game.stake > settings.games.maxBet
  ) {
    throw new Error('INVALID_BET');
  }
  if (!Number.isSafeInteger(game.payout ?? 0) || (game.payout ?? 0) > settings.games.maxPayout) {
    throw new Error('PAYOUT_LIMIT_REACHED');
  }
  return reserveGame(database, {
    userId,
    startingBalance: settings.startingBalance,
    game,
  });
}

export async function settleWager(database, userId, gameId) {
  return settleActiveGame(database, userId, gameId);
}

export async function finishPendingWager(database, userId, wallet) {
  if (wallet?.activeGame?.status === 'settling') {
    await settleActiveGame(database, userId, wallet.activeGame.id);
    return getWallet(database, userId);
  }
  return wallet;
}

export function defaultEconomySettings() {
  return DEFAULT_ECONOMY_SETTINGS;
}
