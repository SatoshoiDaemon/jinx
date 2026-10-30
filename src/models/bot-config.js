import {
  BOT_CONFIG_COLLECTION,
  BOT_CONFIG_ID,
  DEFAULT_LEVEL_SETTINGS,
  DEFAULT_WELCOME_SETTINGS,
} from '../config/defaults.js';

function configCollection(database) {
  return database.collection(BOT_CONFIG_COLLECTION);
}

function validateConfigPath(moduleName, optionPath) {
  if (typeof moduleName !== 'string' || !/^[A-Za-z0-9_-]+$/.test(moduleName)) {
    throw new Error('INVALID_CONFIG_PATH');
  }
  const parts = [moduleName, ...optionPath.split('.')];
  if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part) || part.startsWith('$'))) {
    throw new Error('INVALID_CONFIG_PATH');
  }
  return `modules.${parts.join('.')}`;
}

export async function ensureBotConfig(database) {
  await configCollection(database).updateOne(
    { _id: BOT_CONFIG_ID },
    {
      $setOnInsert: {
        modules: {
          levels: { ...DEFAULT_LEVEL_SETTINGS },
          welcome: DEFAULT_WELCOME_SETTINGS,
        },
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function getModuleConfig(database, moduleName, defaults = {}) {
  validateConfigPath(moduleName, 'settings');
  const collection = configCollection(database);
  let document = await collection.findOne(
    { _id: BOT_CONFIG_ID },
    { projection: { [`modules.${moduleName}`]: 1 } },
  );
  if (!document) {
    await ensureBotConfig(database);
    document = await collection.findOne(
      { _id: BOT_CONFIG_ID },
      { projection: { [`modules.${moduleName}`]: 1 } },
    );
  }
  return {
    ...defaults,
    ...(document?.modules?.[moduleName] ?? {}),
  };
}

export async function updateModuleConfig(database, moduleName, settings) {
  const fields = Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [validateConfigPath(moduleName, key), value]),
  );
  await configCollection(database).updateOne(
    { _id: BOT_CONFIG_ID },
    { $set: { ...fields, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function updateModuleConfigValue(database, moduleName, optionPath, value) {
  const path = validateConfigPath(moduleName, optionPath);
  await configCollection(database).updateOne(
    { _id: BOT_CONFIG_ID },
    { $set: { [path]: value, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function removeModuleConfigValue(database, moduleName, optionPath) {
  const path = validateConfigPath(moduleName, optionPath);
  await configCollection(database).updateOne(
    { _id: BOT_CONFIG_ID },
    { $unset: { [path]: '' }, $set: { updatedAt: new Date() } },
  );
}
