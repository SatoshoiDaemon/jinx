import { DEFAULT_GUILD_SETTINGS } from '../config/defaults.js';

function normalizeConfig(document) {
  return {
    ...DEFAULT_GUILD_SETTINGS,
    ...document,
    roleBoosts: document?.roleBoosts ?? {},
    channelBoosts: document?.channelBoosts ?? {},
  };
}

export async function getGuildConfig(database, guildId) {
  const collection = database.collection('guild_configs');
  let document = await collection.findOne({ guildId });
  if (!document) {
    await collection.updateOne(
      { guildId },
      {
        $setOnInsert: {
          ...DEFAULT_GUILD_SETTINGS,
          roleBoosts: {},
          channelBoosts: {},
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    document = await collection.findOne({ guildId });
  }

  return normalizeConfig(document);
}

export async function saveGuildSettings(database, guildId, settings) {
  await database.collection('guild_configs').updateOne(
    { guildId },
    { $set: { ...settings, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function saveGuildBoost(database, guildId, kind, targetId, multiplier) {
  const field = kind === 'role' ? 'roleBoosts' : 'channelBoosts';
  const path = `${field}.${targetId}`;
  const update = multiplier === null
    ? { $unset: { [path]: '' }, $set: { updatedAt: new Date() } }
    : { $set: { [path]: multiplier, updatedAt: new Date() } };

  await database.collection('guild_configs').updateOne(
    { guildId },
    update,
    { upsert: true },
  );
}
