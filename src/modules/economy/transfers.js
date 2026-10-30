import {
  MAX_WALLET_BALANCE,
} from './config.js';
import {
  ensureWallet,
  getWallet,
  OPERATION_COLLECTION,
  TRANSFER_LOCK_COLLECTION,
  WALLET_COLLECTION,
} from './repository.js';

const FALLBACK_LOCK_ID = 'fallback-transfer';

function transferEntry(id, type, amount, direction, counterpartyId, now) {
  return {
    id,
    type,
    amount,
    direction,
    counterpartyId,
    at: now,
  };
}

function isTransactionsUnsupported(error) {
  const message = String(error?.message ?? '');
  return [20, 303].includes(Number(error?.code))
    || error?.codeName === 'IllegalOperation'
    || message.includes('Transaction numbers are only allowed')
    || message.includes('does not support transactions');
}

function asTransferError(error) {
  if (error?.message === 'TRANSFER_INSUFFICIENT_FUNDS') {
    return new Error('INSUFFICIENT_BALANCE');
  }
  if (error?.message === 'TRANSFER_RECIPIENT_LIMIT') {
    return new Error('BALANCE_LIMIT_REACHED');
  }
  if (error?.message === 'TRANSFER_ACCOUNT_BUSY') {
    return new Error('TRANSFER_PENDING');
  }
  return error;
}

async function transactionTransfer(client, database, {
  operationId,
  fromUserId,
  toUserId,
  amount,
  startingBalance,
  now,
}) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const operations = database.collection(OPERATION_COLLECTION);
      const wallets = database.collection(WALLET_COLLECTION);
      const existing = await operations.findOne({ _id: operationId }, { session });
      if (existing?.state === 'complete') {
        return;
      }
      if (existing) {
        throw new Error('TRANSFER_OPERATION_ALREADY_EXISTS');
      }

      await operations.insertOne({
        _id: operationId,
        type: 'transfer',
        state: 'started',
        fromUserId,
        toUserId,
        amount,
        createdAt: now,
      }, { session });

      const debit = await wallets.updateOne(
        {
          _id: fromUserId,
          balance: { $gte: amount },
          totalSpent: { $lte: MAX_WALLET_BALANCE - amount },
          pendingTransferId: { $exists: false },
        },
        {
          $inc: {
            balance: -amount,
            totalSpent: amount,
            'stats.transfersOut': 1,
          },
          $set: { updatedAt: now },
          $push: {
            transactions: {
              $each: [transferEntry(`${operationId}:out`, 'transfer_out', amount, 'out', toUserId, now)],
              $slice: -30,
            },
          },
        },
        { session },
      );
      if (debit.modifiedCount !== 1) {
        const sender = await wallets.findOne({ _id: fromUserId }, { session, projection: { balance: 1 } });
        throw new Error(sender?.balance < amount ? 'TRANSFER_INSUFFICIENT_FUNDS' : 'TRANSFER_ACCOUNT_BUSY');
      }

      const credit = await wallets.updateOne(
        {
          _id: toUserId,
          balance: { $lte: MAX_WALLET_BALANCE - amount },
          totalReceived: { $lte: MAX_WALLET_BALANCE - amount },
          pendingTransferId: { $exists: false },
        },
        {
          $inc: {
            balance: amount,
            totalReceived: amount,
            'stats.transfersIn': 1,
          },
          $set: { updatedAt: now },
          $push: {
            transactions: {
              $each: [transferEntry(`${operationId}:in`, 'transfer_in', amount, 'in', fromUserId, now)],
              $slice: -30,
            },
          },
        },
        { session },
      );
      if (credit.modifiedCount !== 1) {
        const recipient = await wallets.findOne({ _id: toUserId }, { session, projection: { balance: 1 } });
        throw new Error(recipient?.balance > MAX_WALLET_BALANCE - amount
          ? 'TRANSFER_RECIPIENT_LIMIT'
          : 'TRANSFER_ACCOUNT_BUSY');
      }

      await operations.updateOne(
        { _id: operationId, state: 'started' },
        { $set: { state: 'complete', completedAt: now } },
        { session },
      );
    });
    return { status: 'complete' };
  } catch (error) {
    throw error;
  } finally {
    await session.endSession();
  }
}

async function acquireFallbackLock(database, operationId, now) {
  const locks = database.collection(TRANSFER_LOCK_COLLECTION);
  await locks.updateOne(
    { _id: FALLBACK_LOCK_ID },
    { $setOnInsert: { ownerId: null } },
    { upsert: true },
  );
  const result = await locks.updateOne(
    { _id: FALLBACK_LOCK_ID, ownerId: { $in: [null, operationId] } },
    { $set: { ownerId: operationId, updatedAt: now } },
  );
  return result.modifiedCount === 1
    || (await locks.findOne({ _id: FALLBACK_LOCK_ID }))?.ownerId === operationId;
}

async function clearFallbackLock(database, operationId) {
  await database.collection(TRANSFER_LOCK_COLLECTION).updateOne(
    { _id: FALLBACK_LOCK_ID, ownerId: operationId },
    { $set: { ownerId: null, updatedAt: new Date() } },
  );
}

async function clearPendingTransfer(wallets, userId, operationId) {
  await wallets.updateOne(
    { _id: userId, pendingTransferId: operationId },
    { $unset: { pendingTransferId: '' }, $set: { updatedAt: new Date() } },
  );
}

async function continueFallbackTransfer(database, operation) {
  const wallets = database.collection(WALLET_COLLECTION);
  const operations = database.collection(OPERATION_COLLECTION);
  const { _id: operationId, fromUserId, toUserId, amount } = operation;
  const now = operation.createdAt ?? new Date();

  if (operation.state === 'complete' || operation.state === 'failed') {
    await clearPendingTransfer(wallets, fromUserId, operationId);
    await clearPendingTransfer(wallets, toUserId, operationId);
    await clearFallbackLock(database, operationId);
    return operation.state;
  }

  const recipient = await wallets.findOne({ _id: toUserId });
  if (recipient?.pendingTransferId !== operationId) {
    const reserve = await wallets.updateOne(
      {
        _id: toUserId,
        pendingTransferId: { $exists: false },
        balance: { $lte: MAX_WALLET_BALANCE - amount },
        totalReceived: { $lte: MAX_WALLET_BALANCE - amount },
      },
      { $set: { pendingTransferId: operationId, updatedAt: now } },
    );
    if (reserve.modifiedCount !== 1) {
      const current = await wallets.findOne({ _id: toUserId });
      if (current?.pendingTransferId !== operationId) {
        if (current?.balance > MAX_WALLET_BALANCE - amount) {
          await operations.updateOne(
            { _id: operationId, state: { $nin: ['complete', 'failed'] } },
            { $set: { state: 'failed', failureReason: 'recipient_balance_limit' } },
          );
          await clearFallbackLock(database, operationId);
          throw new Error('BALANCE_LIMIT_REACHED');
        }
        await operations.updateOne(
          { _id: operationId, state: { $nin: ['complete', 'failed'] } },
          { $set: { state: 'created', failureReason: 'recipient_busy' } },
        );
        throw new Error('TRANSFER_RECIPIENT_BUSY');
      }
    }
  }
  await operations.updateOne({ _id: operationId }, { $set: { state: 'recipient_reserved' } });

  let sender = await wallets.findOne({ _id: fromUserId });
  if (sender?.lastTransferOutId !== operationId) {
    const debit = await wallets.updateOne(
      {
        _id: fromUserId,
        pendingTransferId: { $in: [null, operationId] },
        balance: { $gte: amount },
        totalSpent: { $lte: MAX_WALLET_BALANCE - amount },
        lastTransferOutId: { $ne: operationId },
      },
      {
        $inc: { balance: -amount, totalSpent: amount, 'stats.transfersOut': 1 },
        $set: { pendingTransferId: operationId, lastTransferOutId: operationId, updatedAt: now },
        $push: {
          transactions: {
            $each: [transferEntry(`${operationId}:out`, 'transfer_out', amount, 'out', toUserId, now)],
            $slice: -30,
          },
        },
      },
    );
    if (debit.modifiedCount !== 1) {
      sender = await wallets.findOne({ _id: fromUserId });
      if (sender?.lastTransferOutId !== operationId) {
        await clearPendingTransfer(wallets, toUserId, operationId);
        await operations.updateOne(
          { _id: operationId },
          { $set: { state: 'failed', failureReason: sender?.balance < amount ? 'insufficient_balance' : 'account_busy' } },
        );
        await clearFallbackLock(database, operationId);
        if (sender?.balance < amount) {
          throw new Error('INSUFFICIENT_BALANCE');
        }
        throw new Error('TRANSFER_PENDING');
      }
    }
  }
  await operations.updateOne({ _id: operationId }, { $set: { state: 'sender_debited' } });

  const currentRecipient = await wallets.findOne({ _id: toUserId });
  if (currentRecipient?.lastTransferInId !== operationId) {
    const credit = await wallets.updateOne(
      {
        _id: toUserId,
        pendingTransferId: operationId,
        balance: { $lte: MAX_WALLET_BALANCE - amount },
        totalReceived: { $lte: MAX_WALLET_BALANCE - amount },
      },
      {
        $inc: { balance: amount, totalReceived: amount, 'stats.transfersIn': 1 },
        $set: { lastTransferInId: operationId, updatedAt: now },
        $push: {
          transactions: {
            $each: [transferEntry(`${operationId}:in`, 'transfer_in', amount, 'in', fromUserId, now)],
            $slice: -30,
          },
        },
      },
    );
    if (credit.modifiedCount !== 1) {
      throw new Error('TRANSFER_CREDIT_PENDING');
    }
  }
  await operations.updateOne({ _id: operationId }, { $set: { state: 'recipient_credited' } });
  await operations.updateOne(
    { _id: operationId },
    { $set: { state: 'complete', completedAt: new Date() } },
  );
  await clearPendingTransfer(wallets, fromUserId, operationId);
  await clearPendingTransfer(wallets, toUserId, operationId);
  await clearFallbackLock(database, operationId);
  return 'complete';
}

async function fallbackTransfer(database, {
  operationId,
  fromUserId,
  toUserId,
  amount,
  startingBalance,
  now,
}) {
  const operations = database.collection(OPERATION_COLLECTION);
  const existing = await operations.findOne({ _id: operationId });
  if (existing?.state === 'complete') {
    return { status: 'complete' };
  }
  if (existing?.state === 'failed') {
    const error = existing.failureReason === 'insufficient_balance'
      ? 'INSUFFICIENT_BALANCE'
      : existing.failureReason === 'recipient_balance_limit'
        ? 'BALANCE_LIMIT_REACHED'
        : 'TRANSFER_PENDING';
    throw new Error(error);
  }

  if (!await acquireFallbackLock(database, operationId, now)) {
    throw new Error('TRANSFER_BUSY');
  }

  if (!existing) {
    await operations.insertOne({
      _id: operationId,
      type: 'transfer',
      state: 'created',
      fromUserId,
      toUserId,
      amount,
      createdAt: now,
      fallback: true,
    });
  }

  await ensureWallet(database, fromUserId, startingBalance, now);
  await ensureWallet(database, toUserId, startingBalance, now);
  await continueFallbackTransfer(database, existing ?? await operations.findOne({ _id: operationId }));
  return { status: 'complete' };
}

export async function recoverFallbackTransfer(database) {
  const lock = await database.collection(TRANSFER_LOCK_COLLECTION).findOne({ _id: FALLBACK_LOCK_ID });
  if (!lock?.ownerId) {
    return;
  }
  const operation = await database.collection(OPERATION_COLLECTION).findOne({ _id: lock.ownerId });
  if (!operation) {
    await clearFallbackLock(database, lock.ownerId);
    return;
  }
  try {
    await continueFallbackTransfer(database, operation);
  } catch (error) {
    console.error(`[Economia] Transferência pendente preservada para recuperação (${error?.name ?? 'Erro'}).`);
  }
}

export async function transferYen(client, database, {
  operationId,
  fromUserId,
  toUserId,
  amount,
  startingBalance,
  now = new Date(),
}) {
  await ensureWallet(database, fromUserId, startingBalance, now);
  await ensureWallet(database, toUserId, startingBalance, now);

  try {
    await transactionTransfer(client, database, {
      operationId,
      fromUserId,
      toUserId,
      amount,
      startingBalance,
      now,
    });
  } catch (error) {
    if (isTransactionsUnsupported(error)) {
      await fallbackTransfer(database, {
        operationId,
        fromUserId,
        toUserId,
        amount,
        startingBalance,
        now,
      });
    } else {
      throw asTransferError(error);
    }
  }

  const [sender, recipient] = await Promise.all([
    getWallet(database, fromUserId),
    getWallet(database, toUserId),
  ]);
  return { sender, recipient };
}
