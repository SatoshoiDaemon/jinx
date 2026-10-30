import { randomInt } from 'node:crypto';
import { getGuildConfig } from '../../models/guild-config.js';
import {
  adjustMemberXp,
  getMemberXp,
  grantMessageXp,
  setMemberTotalXp,
} from '../../models/member-xp.js';
import { adjustedTotalXpForLevels, levelFromTotalXp, xpProgress } from './rules.js';

export { getGuildConfig } from '../../models/guild-config.js';
export { adjustMemberXp, getMemberXp };
export { adjustedTotalXpForLevels, levelFromTotalXp, validateGuildSettings, xpProgress } from './rules.js';

export async function awardMessageXp(database, { guildId, userId, channelId, roleIds }) {
  const settings = await getGuildConfig(database, guildId);
  const baseXp = randomInt(settings.xpMin, settings.xpMax + 1);
  const roleBoosts = roleIds
    .map((roleId) => Number(settings.roleBoosts[roleId]))
    .filter((multiplier) => Number.isFinite(multiplier)
      && multiplier >= 1
      && multiplier <= settings.maxBoostMultiplier);
  const roleMultiplier = Math.max(
    1,
    ...roleBoosts,
  );
  const configuredChannelMultiplier = Number(settings.channelBoosts[channelId]);
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
    guildId,
    userId,
    amount,
    cooldownSeconds: settings.cooldownSeconds,
  });
}

export async function getMemberProgress(database, guildId, userId) {
  const settings = await getGuildConfig(database, guildId);
  const member = await getMemberXp(database, guildId, userId);
  return xpProgress(member.totalXp, settings);
}

export async function adjustMemberLevels(database, guildId, userId, levelDelta) {
  const settings = await getGuildConfig(database, guildId);
  const member = await getMemberXp(database, guildId, userId);
  const adjusted = adjustedTotalXpForLevels(member.totalXp, levelDelta, settings);
  await setMemberTotalXp(database, guildId, userId, member.totalXp, adjusted.totalXp);
  return adjusted;
}
