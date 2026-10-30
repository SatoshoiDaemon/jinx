import {
  BOT_CONFIG_COLLECTION,
  BOT_CONFIG_ID,
  DEFAULT_ECONOMY_SETTINGS,
  DEFAULT_LEVEL_SETTINGS,
  DEFAULT_RIOT_UPDATES_SETTINGS,
  DEFAULT_TICKET_SETTINGS,
  DEFAULT_WELCOME_SETTINGS,
} from '../config/defaults.js';

function readLegacyLevelSettings(document) {
  if (!document) {
    return { ...DEFAULT_LEVEL_SETTINGS };
  }

  const settings = Object.fromEntries(
    Object.keys(DEFAULT_LEVEL_SETTINGS)
      .filter((key) => key in document)
      .map((key) => [key, document[key]]),
  );
  return {
    ...DEFAULT_LEVEL_SETTINGS,
    ...settings,
    roleBoosts: document.roleBoosts ?? {},
    channelBoosts: document.channelBoosts ?? {},
  };
}

async function migrateLegacyConfig(database, guildId) {
  const legacyCollection = database.collection('guild_configs');
  const legacyDocument = await legacyCollection.findOne({ guildId });
  const createdAt = legacyDocument?.createdAt ?? new Date();
  const targetCollection = database.collection(BOT_CONFIG_COLLECTION);

  await targetCollection.updateOne(
    { _id: BOT_CONFIG_ID },
    {
      $setOnInsert: {
        modules: {
          levels: readLegacyLevelSettings(legacyDocument),
          economy: DEFAULT_ECONOMY_SETTINGS,
          welcome: DEFAULT_WELCOME_SETTINGS,
          tickets: DEFAULT_TICKET_SETTINGS,
          riot_updates: DEFAULT_RIOT_UPDATES_SETTINGS,
        },
        createdAt,
        ...(legacyDocument?.updatedAt ? { updatedAt: legacyDocument.updatedAt } : {}),
      },
    },
    { upsert: true },
  );

  const migratedDocument = await targetCollection.findOne(
    { _id: BOT_CONFIG_ID },
    { projection: { _id: 1 } },
  );
  if (!migratedDocument) {
    throw new Error('BOT_CONFIG_MIGRATION_FAILED');
  }

  if (legacyDocument) {
    await legacyCollection.deleteOne({ _id: legacyDocument._id });
  }
}

function isLegacyMemberIndex(index) {
  const fields = Object.entries(index.key ?? {});
  return fields.length === 2
    && fields[0][0] === 'guildId'
    && fields[0][1] === 1
    && fields[1][0] === 'userId'
    && fields[1][1] === 1;
}

async function migrateLegacyMemberXp(database, guildId) {
  const members = database.collection('member_xp');
  const legacyMembers = await members.find({ guildId }).toArray();
  const seenUserIds = new Set();

  for (const legacyMember of legacyMembers) {
    if (
      typeof legacyMember.userId !== 'string'
      || !legacyMember.userId
      || seenUserIds.has(legacyMember.userId)
    ) {
      throw new Error('MEMBER_XP_MIGRATION_FAILED');
    }
    seenUserIds.add(legacyMember.userId);
  }

  for (const legacyMember of legacyMembers) {
    const currentMember = await members.findOne({ _id: legacyMember.userId }, { projection: { _id: 1 } });
    if (!currentMember) {
      const memberData = { ...legacyMember };
      delete memberData._id;
      delete memberData.guildId;
      try {
        await members.insertOne({
          ...memberData,
          _id: legacyMember.userId,
          userId: legacyMember.userId,
        });
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }
        const migratedMember = await members.findOne(
          { _id: legacyMember.userId },
          { projection: { _id: 1 } },
        );
        if (!migratedMember) {
          throw error;
        }
      }
    }

    await members.deleteOne({ _id: legacyMember._id });
  }

  const collectionExists = await database
    .listCollections({ name: 'member_xp' }, { nameOnly: true })
    .hasNext();
  if (!collectionExists) {
    return;
  }

  const indexes = await members.listIndexes().toArray();
  for (const index of indexes) {
    if (isLegacyMemberIndex(index)) {
      await members.dropIndex(index.name);
    }
  }
}

export async function initializeDatabase(database, guildId) {
  await migrateLegacyConfig(database, guildId);
  await migrateLegacyMemberXp(database, guildId);
  await database.collection(BOT_CONFIG_COLLECTION).updateOne(
    { _id: BOT_CONFIG_ID, 'modules.economy': { $exists: false } },
    { $set: { 'modules.economy': DEFAULT_ECONOMY_SETTINGS } },
  );
  await database.collection(BOT_CONFIG_COLLECTION).updateOne(
    { _id: BOT_CONFIG_ID, 'modules.tickets': { $exists: false } },
    { $set: { 'modules.tickets': DEFAULT_TICKET_SETTINGS } },
  );
  await database.collection(BOT_CONFIG_COLLECTION).updateOne(
    { _id: BOT_CONFIG_ID, 'modules.riot_updates': { $exists: false } },
    { $set: { 'modules.riot_updates': DEFAULT_RIOT_UPDATES_SETTINGS } },
  );
}
