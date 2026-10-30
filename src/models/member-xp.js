const MAX_SAFE_XP = Number.MAX_SAFE_INTEGER;

async function ensureMember(collection, userId, now) {
  try {
    await collection.updateOne(
      { _id: userId },
      { $setOnInsert: { userId, totalXp: 0, createdAt: now } },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
}

export async function getMemberXp(database, userId) {
  const member = await database.collection('member_xp').findOne({ _id: userId });
  return { totalXp: member?.totalXp ?? 0, lastXpAt: member?.lastXpAt ?? null };
}

export async function grantMessageXp(database, {
  userId,
  amount,
  cooldownSeconds,
  now = new Date(),
}) {
  if (!Number.isSafeInteger(amount) || amount < 1) {
    return false;
  }

  const collection = database.collection('member_xp');
  const cutoff = new Date(now.getTime() - cooldownSeconds * 1000);
  try {
    const result = await collection.updateOne(
      {
        _id: userId,
        totalXp: { $lte: MAX_SAFE_XP - amount },
        $or: [
          { lastXpAt: { $exists: false } },
          { lastXpAt: { $lte: cutoff } },
        ],
      },
      {
        $inc: { totalXp: amount },
        $set: { lastXpAt: now, updatedAt: now },
        $setOnInsert: { userId, createdAt: now },
      },
      { upsert: true },
    );

    return result.modifiedCount === 1 || result.upsertedCount === 1;
  } catch (error) {
    if (error?.code === 11000) {
      return false;
    }
    throw error;
  }
}

export async function adjustMemberXp(database, userId, direction, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || !['add', 'remove'].includes(direction)) {
    throw new Error('INVALID_XP_ADJUSTMENT');
  }

  const collection = database.collection('member_xp');
  const now = new Date();
  await ensureMember(collection, userId, now);

  const totalXpFilter = direction === 'add'
    ? { $lte: MAX_SAFE_XP - amount }
    : { $gte: amount };
  const change = direction === 'add' ? amount : -amount;
  const result = await collection.updateOne(
    { _id: userId, totalXp: totalXpFilter },
    { $inc: { totalXp: change }, $set: { updatedAt: now } },
  );

  if (result.modifiedCount !== 1) {
    throw new Error(direction === 'remove' ? 'INSUFFICIENT_XP' : 'XP_LIMIT_REACHED');
  }

  return getMemberXp(database, userId);
}

export async function setMemberTotalXp(database, userId, expectedTotalXp, newTotalXp) {
  if (!Number.isSafeInteger(newTotalXp) || newTotalXp < 0) {
    throw new Error('INVALID_TOTAL_XP');
  }

  const collection = database.collection('member_xp');
  const now = new Date();
  await ensureMember(collection, userId, now);
  const result = await collection.updateOne(
    { _id: userId, totalXp: expectedTotalXp },
    { $set: { totalXp: newTotalXp, updatedAt: now } },
  );

  if (result.modifiedCount !== 1) {
    throw new Error('XP_CHANGED_CONCURRENTLY');
  }

  return { totalXp: newTotalXp };
}
