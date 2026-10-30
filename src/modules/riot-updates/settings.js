import { DEFAULT_RIOT_UPDATES_SETTINGS } from '../../config/defaults.js';
import { getModuleConfig, updateModuleConfigValue } from '../../models/bot-config.js';

function mergeSettings(defaults, stored) {
  const result = structuredClone(defaults);
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object') {
      result[key] = mergeSettings(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function normalizeRiotSettings(stored = {}) {
  const settings = mergeSettings(DEFAULT_RIOT_UPDATES_SETTINGS, stored);
  if (!['pt-br', 'en-us'].includes(settings.preferredLanguage)) settings.preferredLanguage = 'pt-br';
  if (!['register_only', 'publish_recent'].includes(settings.firstActivationPolicy)) {
    settings.firstActivationPolicy = 'register_only';
  }
  settings.fallbackEnglish = settings.fallbackEnglish !== false;
  settings.scheduler.enabled = settings.scheduler.enabled === true;
  settings.scheduler.regularIntervalHours = 12;
  return settings;
}

export async function getRiotSettings(database) {
  const stored = await getModuleConfig(database, 'riot_updates', DEFAULT_RIOT_UPDATES_SETTINGS);
  return normalizeRiotSettings(stored);
}

export function isValidUtcClock(value) {
  const match = /^(\d{2}):(\d{2})$/u.exec(String(value ?? ''));
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

export function validateRiotWindow({ start, end }) {
  if (!isValidUtcClock(start) || !isValidUtcClock(end)) return false;
  const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return minutes(end) > minutes(start);
}

export async function updateRiotSetting(database, path, value) {
  const allowedPaths = new Set([
    'patchNotes.enabled', 'patchNotes.channelId', 'patchNotes.roleId', 'patchNotes.webhook', 'patchNotes.baselineCompletedAt',
    'updates.enabled', 'updates.channelId', 'updates.roleId', 'updates.webhook', 'updates.baselineCompletedAt',
    'preferredLanguage', 'fallbackEnglish', 'firstActivationPolicy', 'scheduler.enabled',
    'scheduler.tuesday.end', 'scheduler.wednesday.end', 'scheduler.minorWindow.durationHours',
    'scheduler.majorWindow.durationHours', 'scheduler.minorWindow.enabled', 'scheduler.majorWindow.enabled',
  ]);
  if (!allowedPaths.has(path)) throw new Error('RIOT_SETTING_PATH_INVALID');
  await updateModuleConfigValue(database, 'riot_updates', path, value);
}
