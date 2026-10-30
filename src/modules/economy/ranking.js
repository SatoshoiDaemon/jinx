import { DEFAULT_LEVEL_SETTINGS } from '../../config/defaults.js';
import { getModuleConfig } from '../../models/bot-config.js';
import { levelFromTotalXp } from '../levels/rules.js';
import { getEconomySettings } from './config.js';
import { ensureWallet, WALLET_COLLECTION } from './repository.js';

const RANKING_LIMIT = 10;

export async function getEconomyRanking(database, userId) {
  const settings = await getEconomySettings(database);
  const wallet = await ensureWallet(database, userId, settings.startingBalance);
  const collection = database.collection(WALLET_COLLECTION);
  const entries = await collection.find({})
    .sort({ balance: -1, _id: 1 })
    .limit(RANKING_LIMIT)
    .project({ balance: 1, totalReceived: 1, totalSpent: 1 })
    .toArray();
  const ahead = await collection.countDocuments({
    $or: [
      { balance: { $gt: wallet.balance } },
      { balance: wallet.balance, _id: { $lt: userId } },
    ],
  });
  return { entries, userPosition: ahead + 1, userWallet: wallet };
}

export async function getLevelRanking(database, userId) {
  const settings = await getModuleConfig(database, 'levels', DEFAULT_LEVEL_SETTINGS);
  const collection = database.collection('member_xp');
  const current = await collection.findOne({ _id: userId }, { projection: { totalXp: 1 } });
  const userXp = Number.isSafeInteger(current?.totalXp) && current.totalXp >= 0
    ? current.totalXp
    : 0;
  const documents = await collection.find({ totalXp: { $gte: 0 } })
    .sort({ totalXp: -1, _id: 1 })
    .limit(RANKING_LIMIT)
    .project({ _id: 1, userId: 1, totalXp: 1 })
    .toArray();
  const entries = documents
    .filter((document) => Number.isSafeInteger(document.totalXp) && document.totalXp >= 0)
    .map((document) => {
      const totalXp = document.totalXp;
      return {
        userId: document.userId ?? document._id,
        totalXp,
        level: levelFromTotalXp(totalXp, settings),
      };
    });
  const userLevel = levelFromTotalXp(userXp, settings);
  const ahead = await collection.countDocuments({
    $or: [
      { totalXp: { $gt: userXp } },
      { totalXp: userXp, _id: { $lt: userId } },
    ],
  });
  return {
    entries,
    userPosition: ahead + 1,
    userEntry: { userId, totalXp: userXp, level: userLevel },
  };
}
