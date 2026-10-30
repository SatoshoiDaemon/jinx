import { DEFAULT_GUILD_SETTINGS } from '../config/defaults.js';

export async function initializeDatabase(database, guildId) {
  const guildConfigs = database.collection('guild_configs');
  const membersXp = database.collection('member_xp');

  await Promise.all([
    guildConfigs.createIndex({ guildId: 1 }, { unique: true }),
    membersXp.createIndex({ guildId: 1, userId: 1 }, { unique: true }),
    guildConfigs.updateOne(
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
    ),
  ]);
}
