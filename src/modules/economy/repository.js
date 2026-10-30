import { randomUUID } from 'node:crypto';
import { MAX_WALLET_BALANCE } from './config.js';

export const WALLET_COLLECTION = 'economy_wallets';
export const OPERATION_COLLECTION = 'economy_operations';
export const TRANSFER_LOCK_COLLECTION = 'economy_transfer_locks';
const TRANSACTION_HISTORY_LIMIT = 30;

const DEFAULT_STATS = Object.freeze({
  dailyClaims: 0,
  workCount: 0,
  crimeSuccesses: 0,
  crimeFailures: 0,
  betsWon: 0,
  betsLost: 0,
  gamesVoided: 0,
  totalWagered: 0,
  totalPaidOut: 0,
  transfersIn: 0,
  transfersOut: 0,
});

function wallets(database) {
  return database.collection(WALLET_COLLECTION);
}

function transactionEntry({ id = randomUUID(), type, amount, direction, now, ...details }) {
  return { id, type, amount, direction, at: now, ...details };
}

function pushTransaction(entry) {
  return { $each: [entry], $slice: -TRANSACTION_HISTORY_LIMIT };
}

function initialWallet(userId, startingBalance, now) {
  const transactions = startingBalance > 0
    ? [transactionEntry({
      id: `starting:${userId}`,
      type: 'starting_balance',
      amount: startingBalance,
      direction: 'in',
      now,
    })]
    : [];
  return {
    userId,
    balance: startingBalance,
    totalReceived: startingBalance,
    totalSpent: 0,
    dailyStreak: 0,
    transactions,
    stats: { ...DEFAULT_STATS },
    activeGame: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function ensureWallet(database, userId, startingBalance, now = new Date()) {
  const collection = wallets(database);
  try {
    await collection.updateOne(
      { _id: userId },
      { $setOnInsert: initialWallet(userId, startingBalance, now) },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
  return collection.findOne({ _id: userId });
}

export function getWallet(database, userId) {
  return wallets(database).findOne({ _id: userId });
}

export async function ensureWallets(database, userIds, startingBalance, now = new Date()) {
  const collection = wallets(database);
  const operations = userIds.map((userId) => ({
    updateOne: {
      filter: { _id: userId },
      update: { $setOnInsert: initialWallet(userId, startingBalance, now) },
      upsert: true,
    },
  }));
  if (!operations.length) {
    return;
  }
  for (let offset = 0; offset < operations.length; offset += 1000) {
    try {
      await collection.bulkWrite(operations.slice(offset, offset + 1000), { ordered: false });
    } catch (error) {
      const rawWriteErrors = error?.writeErrors ?? error?.result?.getWriteErrors?.() ?? [];
      const writeErrors = Array.isArray(rawWriteErrors) ? rawWriteErrors : [...rawWriteErrors.values()];
      const duplicateOnly = writeErrors.length > 0 && writeErrors.every((item) => item.code === 11000);
      if (error?.code !== 11000 && !duplicateOnly) {
        throw error;
      }
    }
  }
}

export async function initializeEconomyRepository(database) {
  await wallets(database).createIndex(
    { balance: -1, _id: 1 },
    { name: 'economy_balance_ranking' },
  );
  await database.collection('member_xp').createIndex(
    { totalXp: -1, _id: 1 },
    { name: 'member_xp_ranking' },
  );
  await database.collection(TRANSFER_LOCK_COLLECTION).updateOne(
    { _id: 'fallback-transfer' },
    { $setOnInsert: { ownerId: null, updatedAt: new Date() } },
    { upsert: true },
  );
}

function activeWalletFilter(userId) {
  return { _id: userId, pendingTransferId: { $exists: false } };
}

function cooldownFilter(userId, cooldownPath, cutoff) {
  return {
    ...activeWalletFilter(userId),
    $or: [
      { [cooldownPath]: { $exists: false } },
      { [cooldownPath]: { $lte: cutoff } },
    ],
  };
}

function remainingCooldown(lastUsedAt, now, durationMs) {
  if (!lastUsedAt) {
    return 0;
  }
  return Math.max(0, durationMs - (now.getTime() - new Date(lastUsedAt).getTime()));
}

function actionStatus(wallet, cooldownPath, now, durationMs) {
  if (wallet?.pendingTransferId) {
    return { status: 'transfer_pending' };
  }
  const remainingMs = remainingCooldown(wallet?.cooldowns?.[cooldownPath], now, durationMs);
  if (remainingMs > 0) {
    return { status: 'cooldown', remainingMs };
  }
  return { status: 'concurrent_update' };
}

export async function claimDaily(database, {
  userId,
  settings,
  now = new Date(),
}) {
  const collection = wallets(database);
  const wallet = await ensureWallet(database, userId, settings.startingBalance, now);
  const cooldownMs = settings.daily.cooldownHours * 60 * 60 * 1000;
  const lastDailyAt = wallet.cooldowns?.dailyLastAt ? new Date(wallet.cooldowns.dailyLastAt) : null;
  const consecutiveGapMs = cooldownMs + 24 * 60 * 60 * 1000;
  const consecutive = lastDailyAt
    && now.getTime() - lastDailyAt.getTime() <= consecutiveGapMs;
  const streak = settings.daily.streak.enabled
    ? (consecutive ? (wallet.dailyStreak ?? 0) + 1 : 1)
    : 0;
  const streakBonus = settings.daily.streak.enabled
    ? Math.min(
      settings.daily.streak.maxBonus,
      Math.min(streak, settings.daily.streak.maxDays) * settings.daily.streak.bonusPerDay,
    )
    : 0;
  const reward = settings.daily.reward + streakBonus;
  const entry = transactionEntry({
    type: 'daily',
    amount: reward,
    direction: 'in',
    now,
    streak,
  });
  const cutoff = new Date(now.getTime() - cooldownMs);
  const filter = {
    ...cooldownFilter(userId, 'cooldowns.dailyLastAt', cutoff),
    balance: { $lte: MAX_WALLET_BALANCE - reward },
    totalReceived: { $lte: MAX_WALLET_BALANCE - reward },
  };
  const result = await collection.updateOne(
    filter,
    {
      $inc: {
        balance: reward,
        totalReceived: reward,
        'stats.dailyClaims': 1,
      },
      $set: {
        'cooldowns.dailyLastAt': now,
        dailyStreak: streak,
        updatedAt: now,
      },
      $push: { transactions: pushTransaction(entry) },
    },
  );

  if (result.modifiedCount === 1) {
    const updated = await collection.findOne({ _id: userId }, { projection: { balance: 1 } });
    return { status: 'claimed', reward, streak, balance: updated.balance };
  }

  const current = await collection.findOne({ _id: userId });
  if (current && current.balance > MAX_WALLET_BALANCE - reward) {
    return { status: 'balance_limit' };
  }
  return actionStatus(current, 'dailyLastAt', now, cooldownMs);
}

export async function claimWork(database, {
  userId,
  settings,
  reward,
  replyId,
  now = new Date(),
}) {
  const collection = wallets(database);
  await ensureWallet(database, userId, settings.startingBalance, now);
  const cooldownMs = settings.work.cooldownSeconds * 1000;
  const entry = transactionEntry({
    type: 'work',
    amount: reward,
    direction: 'in',
    now,
    replyId,
  });
  const result = await collection.updateOne(
    {
      ...cooldownFilter(userId, 'cooldowns.workLastAt', new Date(now.getTime() - cooldownMs)),
      balance: { $lte: MAX_WALLET_BALANCE - reward },
      totalReceived: { $lte: MAX_WALLET_BALANCE - reward },
    },
    {
      $inc: { balance: reward, totalReceived: reward, 'stats.workCount': 1 },
      $set: { 'cooldowns.workLastAt': now, updatedAt: now },
      $push: {
        transactions: pushTransaction(entry),
        recentWorkReplyIds: { $each: [replyId], $slice: -3 },
      },
    },
  );
  if (result.modifiedCount === 1) {
    const updated = await collection.findOne({ _id: userId }, { projection: { balance: 1 } });
    return { status: 'claimed', reward, balance: updated.balance };
  }
  const current = await collection.findOne({ _id: userId });
  if (current && current.balance > MAX_WALLET_BALANCE - reward) {
    return { status: 'balance_limit' };
  }
  return actionStatus(current, 'workLastAt', now, cooldownMs);
}

export async function claimCrime(database, {
  userId,
  settings,
  success,
  amount,
  now = new Date(),
}) {
  const collection = wallets(database);
  const wallet = await ensureWallet(database, userId, settings.startingBalance, now);
  const cooldownMs = settings.crime.cooldownSeconds * 1000;
  const lastCrimeAt = wallet.cooldowns?.crimeLastAt;
  const remainingMs = remainingCooldown(lastCrimeAt, now, cooldownMs);
  if (remainingMs > 0) {
    return { status: 'cooldown', remainingMs };
  }
  if (wallet.pendingTransferId) {
    return { status: 'transfer_pending' };
  }

  const actualAmount = success ? amount : Math.min(amount, wallet.balance);
  const entry = transactionEntry({
    type: success ? 'crime_success' : 'crime_failure',
    amount: actualAmount,
    direction: success ? 'in' : 'out',
    now,
  });
  const result = await collection.updateOne(
    {
      ...cooldownFilter(userId, 'cooldowns.crimeLastAt', new Date(now.getTime() - cooldownMs)),
      balance: success
        ? { $lte: MAX_WALLET_BALANCE - actualAmount }
        : wallet.balance,
      ...(success
        ? { totalReceived: { $lte: MAX_WALLET_BALANCE - actualAmount } }
        : { totalSpent: { $lte: MAX_WALLET_BALANCE - actualAmount } }),
    },
    {
      $inc: success
        ? {
          balance: actualAmount,
          totalReceived: actualAmount,
          'stats.crimeSuccesses': 1,
        }
        : {
          balance: -actualAmount,
          totalSpent: actualAmount,
          'stats.crimeFailures': 1,
        },
      $set: { 'cooldowns.crimeLastAt': now, updatedAt: now },
      $push: { transactions: pushTransaction(entry) },
    },
  );
  if (result.modifiedCount === 1) {
    const updated = await collection.findOne({ _id: userId }, { projection: { balance: 1 } });
    return { status: 'completed', success, amount: actualAmount, balance: updated.balance };
  }
  const current = await collection.findOne({ _id: userId });
  if (current?.pendingTransferId) {
    return { status: 'transfer_pending' };
  }
  if (success && current && current.balance > MAX_WALLET_BALANCE - actualAmount) {
    return { status: 'balance_limit' };
  }
  return { status: 'concurrent_update' };
}

export async function adjustWalletByAdmin(database, {
  userId,
  adminId,
  direction,
  amount,
  startingBalance,
  now = new Date(),
}) {
  const collection = wallets(database);
  await ensureWallet(database, userId, startingBalance, now);
  const adding = direction === 'add';
  const entry = transactionEntry({
    type: adding ? 'admin_add' : 'admin_remove',
    amount,
    direction: adding ? 'in' : 'out',
    now,
    adminId,
  });
  const result = await collection.updateOne(
    {
      ...activeWalletFilter(userId),
      balance: adding
        ? { $lte: MAX_WALLET_BALANCE - amount }
        : { $gte: amount },
      ...(adding
        ? { totalReceived: { $lte: MAX_WALLET_BALANCE - amount } }
        : { totalSpent: { $lte: MAX_WALLET_BALANCE - amount } }),
    },
    {
      $inc: adding
        ? { balance: amount, totalReceived: amount }
        : { balance: -amount, totalSpent: amount },
      $set: { updatedAt: now },
      $push: { transactions: pushTransaction(entry) },
    },
  );
  const wallet = await collection.findOne({ _id: userId });
  if (result.modifiedCount !== 1) {
    if (wallet?.pendingTransferId) {
      throw new Error('TRANSFER_PENDING');
    }
    if (!adding && wallet?.balance < amount) {
      throw new Error('INSUFFICIENT_BALANCE');
    }
    throw new Error(adding ? 'BALANCE_LIMIT_REACHED' : 'WALLET_CHANGED');
  }
  return wallet;
}

export async function reserveGame(database, {
  userId,
  startingBalance,
  game,
  now = new Date(),
}) {
  const collection = wallets(database);
  await ensureWallet(database, userId, startingBalance, now);
  const stakeEntry = transactionEntry({
    id: `game:${game.id}:stake`,
    type: 'game_stake',
    amount: game.stake,
    direction: 'out',
    now,
    gameId: game.id,
    gameType: game.kind,
  });
  const result = await collection.updateOne(
    {
      ...activeWalletFilter(userId),
      balance: { $gte: game.stake },
      totalSpent: { $lte: MAX_WALLET_BALANCE - game.stake },
      'stats.totalWagered': { $lte: MAX_WALLET_BALANCE - game.stake },
      activeGame: null,
    },
    {
      $inc: {
        balance: -game.stake,
        totalSpent: game.stake,
        'stats.totalWagered': game.stake,
      },
      $set: { activeGame: game, updatedAt: now },
      $push: { transactions: pushTransaction(stakeEntry) },
    },
  );
  if (result.modifiedCount === 1) {
    return { status: 'reserved', wallet: await collection.findOne({ _id: userId }) };
  }
  const wallet = await collection.findOne({ _id: userId });
  if (wallet?.pendingTransferId) {
    return { status: 'transfer_pending', wallet };
  }
  if (wallet?.activeGame) {
    return { status: 'active_game', wallet };
  }
  return { status: 'insufficient_balance', wallet };
}

export async function updateActiveGame(database, {
  userId,
  gameId,
  version,
  game,
  now = new Date(),
}) {
  const result = await wallets(database).updateOne(
    {
      ...activeWalletFilter(userId),
      'activeGame.id': gameId,
      'activeGame.status': 'playing',
      'activeGame.version': version,
      'activeGame.expiresAt': { $gt: now },
    },
    { $set: { activeGame: game, updatedAt: now } },
  );
  return result.modifiedCount === 1;
}

export async function settleActiveGame(database, userId, gameId, now = new Date()) {
  const collection = wallets(database);
  const wallet = await collection.findOne({
    _id: userId,
    'activeGame.id': gameId,
    'activeGame.status': 'settling',
  });
  if (!wallet?.activeGame) {
    return { status: 'already_settled' };
  }
  const game = wallet.activeGame;
  if (!Number.isSafeInteger(game.payout) || game.payout < 0 || game.payout > MAX_WALLET_BALANCE) {
    throw new Error('INVALID_GAME_PAYOUT');
  }
  const entry = transactionEntry({
    id: `game:${game.id}:payout`,
    type: game.outcome === 'void' ? 'game_refund' : 'game_payout',
    amount: game.payout,
    direction: 'in',
    now,
    gameId: game.id,
    gameType: game.kind,
    outcome: game.outcome,
  });
  const increments = {
    balance: game.payout,
    totalReceived: game.payout,
    'stats.totalPaidOut': game.payout,
  };
  if (game.outcome === 'win' || game.outcome === 'blackjack') {
    increments['stats.betsWon'] = 1;
  } else if (game.outcome === 'loss') {
    increments['stats.betsLost'] = 1;
  } else if (game.outcome === 'void') {
    increments['stats.gamesVoided'] = 1;
  }
  const result = await collection.updateOne(
    {
      ...activeWalletFilter(userId),
      'activeGame.id': gameId,
      'activeGame.status': 'settling',
      balance: { $lte: MAX_WALLET_BALANCE - game.payout },
      totalReceived: { $lte: MAX_WALLET_BALANCE - game.payout },
      'stats.totalPaidOut': { $lte: MAX_WALLET_BALANCE - game.payout },
    },
    {
      $inc: increments,
      $set: { activeGame: null, updatedAt: now },
      $push: { transactions: pushTransaction(entry) },
    },
  );
  if (result.modifiedCount === 1) {
    return { status: 'settled', payout: game.payout, outcome: game.outcome };
  }
  const current = await collection.findOne({ _id: userId });
  if (current?.pendingTransferId) {
    return { status: 'transfer_pending' };
  }
  if (current?.activeGame?.id === gameId && current.balance > MAX_WALLET_BALANCE - game.payout) {
    throw new Error('BALANCE_LIMIT_REACHED');
  }
  return { status: 'already_settled' };
}

export async function expireActiveGame(database, userId, gameId, now = new Date()) {
  const collection = wallets(database);
  const wallet = await collection.findOne({
    _id: userId,
    'activeGame.id': gameId,
    'activeGame.status': 'playing',
    'activeGame.expiresAt': { $lte: now },
  });
  if (!wallet?.activeGame) {
    return { status: 'not_expired' };
  }
  const game = wallet.activeGame;
  const entry = transactionEntry({
    id: `game:${game.id}:expired-refund`,
    type: 'game_refund',
    amount: game.stake,
    direction: 'in',
    now,
    gameId: game.id,
    gameType: game.kind,
    outcome: 'void',
  });
  const result = await collection.updateOne(
    {
      ...activeWalletFilter(userId),
      'activeGame.id': gameId,
      'activeGame.status': 'playing',
      'activeGame.expiresAt': { $lte: now },
      balance: { $lte: MAX_WALLET_BALANCE - game.stake },
      totalReceived: { $lte: MAX_WALLET_BALANCE - game.stake },
      'stats.totalPaidOut': { $lte: MAX_WALLET_BALANCE - game.stake },
    },
    {
      $inc: {
        balance: game.stake,
        totalReceived: game.stake,
        'stats.totalPaidOut': game.stake,
        'stats.gamesVoided': 1,
      },
      $set: { activeGame: null, updatedAt: now },
      $push: { transactions: pushTransaction(entry) },
    },
  );
  return result.modifiedCount === 1
    ? { status: 'refunded', amount: game.stake }
    : { status: 'not_expired' };
}

export async function recoverGameStates(database) {
  const collection = wallets(database);
  const settlingGames = await collection.find(
    { 'activeGame.status': 'settling' },
    { projection: { _id: 1, 'activeGame.id': 1 } },
  ).toArray();
  for (const wallet of settlingGames) {
    try {
      await settleActiveGame(database, wallet._id, wallet.activeGame.id);
    } catch (error) {
      console.error(`[Economia] Falha ao recuperar pagamento de uma aposta (${error?.name ?? 'Erro'}).`);
    }
  }

  const expiredGames = await collection.find(
    { 'activeGame.status': 'playing', 'activeGame.expiresAt': { $lte: new Date() } },
    { projection: { _id: 1, 'activeGame.id': 1 } },
  ).toArray();
  for (const wallet of expiredGames) {
    try {
      await expireActiveGame(database, wallet._id, wallet.activeGame.id);
    } catch (error) {
      console.error(`[Economia] Falha ao expirar uma aposta abandonada (${error?.name ?? 'Erro'}).`);
    }
  }
}
