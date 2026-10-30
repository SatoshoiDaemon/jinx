import { randomInt } from 'node:crypto';
import { DEFAULT_LEVEL_SETTINGS } from '../../config/defaults.js';
import { getModuleConfig } from '../../models/bot-config.js';
import {
  adjustMemberXp,
  getMemberXp,
  grantMessageXp,
  setMemberTotalXp,
} from '../../models/member-xp.js';
import { adjustedTotalXpForLevels, levelFromTotalXp, xpProgress } from './rules.js';

export { getModuleConfig } from '../../models/bot-config.js';
export { adjustMemberXp, getMemberXp };
export { adjustedTotalXpForLevels, levelFromTotalXp, validateLevelSettings, xpProgress } from './rules.js';

export async function awardMessageXp(database, { userId, channelId, roleIds }) {
  const settings = await getModuleConfig(database, 'levels', DEFAULT_LEVEL_SETTINGS);
  const roleBoostSettings = settings.roleBoosts ?? {};
  const channelBoostSettings = settings.channelBoosts ?? {};
  const baseXp = randomInt(settings.xpMin, settings.xpMax + 1);
  const roleBoosts = roleIds
    .map((roleId) => Number(roleBoostSettings[roleId]))
    .filter((multiplier) => Number.isFinite(multiplier)
      && multiplier >= 1
      && multiplier <= settings.maxBoostMultiplier);
  const roleMultiplier = Math.max(
    1,
    ...roleBoosts,
  );
  const configuredChannelMultiplier = Number(channelBoostSettings[channelId]);
  const channelMultiplier = Number.isFinite(configuredChannelMultiplier)
    && configuredChannelMultiplier >= 1
    && configuredChannelMultiplier <= settings.maxBoostMultiplier
    ? configuredChannelMultiplier
    : 1;
  const amount = Math.floor(baseXp * roleMultiplier * channelMultiplier);

  if (!Number.isSafeInteger(amount) || amount < 1) {
    return false;
  }

  return grantMessageXp(database, {
    userId,
    amount,
    cooldownSeconds: settings.cooldownSeconds,
  });
}

export async function getMemberProgress(database, userId) {
  const settings = await getModuleConfig(database, 'levels', DEFAULT_LEVEL_SETTINGS);
  const member = await getMemberXp(database, userId);
  return xpProgress(member.totalXp, settings);
}

export async function adjustMemberLevels(database, userId, levelDelta) {
  const settings = await getModuleConfig(database, 'levels', DEFAULT_LEVEL_SETTINGS);
  const member = await getMemberXp(database, userId);
  const adjusted = adjustedTotalXpForLevels(member.totalXp, levelDelta, settings);
  await setMemberTotalXp(database, userId, member.totalXp, adjusted.totalXp);
  return adjusted;
}
