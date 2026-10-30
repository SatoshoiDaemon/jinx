const MAX_SAFE_XP = Number.MAX_SAFE_INTEGER;
const MAX_COOLDOWN_SECONDS = 8_640_000_000_000;

export function xpNeededForNextLevel(level, settings) {
  return settings.xpBase + level * settings.xpStep;
}

export function xpAtLevel(level, settings) {
  if (!Number.isSafeInteger(level) || level < 1) {
    return Number.POSITIVE_INFINITY;
  }

  const completedLevels = level - 1;
  const total = completedLevels * settings.xpBase
    + (settings.xpStep * completedLevels * level) / 2;
  return Number.isSafeInteger(total) && total <= MAX_SAFE_XP
    ? total
    : Number.POSITIVE_INFINITY;
}

export function levelFromTotalXp(totalXp, settings) {
  if (!Number.isSafeInteger(totalXp) || totalXp < 0) {
    return 1;
  }

  let low = 1;
  let high = 2;
  while (xpAtLevel(high, settings) <= totalXp) {
    low = high;
    high *= 2;
  }

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (xpAtLevel(middle, settings) <= totalXp) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return low;
}

export function xpProgress(totalXp, settings) {
  const level = levelFromTotalXp(totalXp, settings);
  const currentLevelXp = xpAtLevel(level, settings);
  const required = xpNeededForNextLevel(level, settings);
  const canReachNextLevel = Number.isSafeInteger(required);

  return {
    level,
    totalXp,
    currentLevelXp,
    xpIntoLevel: totalXp - currentLevelXp,
    xpToNextLevel: canReachNextLevel ? required : null,
    xpRemaining: canReachNextLevel ? Math.max(0, required - (totalXp - currentLevelXp)) : null,
  };
}

export function adjustedTotalXpForLevels(totalXp, levelDelta, settings) {
  if (!Number.isSafeInteger(levelDelta) || levelDelta === 0) {
    throw new Error('INVALID_LEVEL_ADJUSTMENT');
  }

  const currentLevel = levelFromTotalXp(totalXp, settings);
  const targetLevel = currentLevel + levelDelta;
  if (targetLevel < 1) {
    throw new Error('LEVEL_FLOOR_REACHED');
  }

  const currentThreshold = xpAtLevel(currentLevel, settings);
  const targetThreshold = xpAtLevel(targetLevel, settings);
  const targetNextLevelXp = xpNeededForNextLevel(targetLevel, settings);
  if (!Number.isSafeInteger(targetThreshold) || !Number.isSafeInteger(targetNextLevelXp)) {
    throw new Error('XP_LIMIT_REACHED');
  }

  const progress = totalXp - currentThreshold;
  const boundedProgress = Math.min(progress, targetNextLevelXp - 1);
  const adjustedTotalXp = targetThreshold + boundedProgress;
  if (!Number.isSafeInteger(adjustedTotalXp) || adjustedTotalXp < 0) {
    throw new Error('XP_LIMIT_REACHED');
  }

  return { level: targetLevel, totalXp: adjustedTotalXp };
}

export function validateGuildSettings(values) {
  const fields = ['xpBase', 'xpStep', 'xpMin', 'xpMax', 'cooldownSeconds'];
  const settings = {};
  for (const field of fields) {
    const value = Number(values[field]);
    if (!Number.isSafeInteger(value)) {
      throw new Error('CONFIGURATION_INVALID');
    }
    settings[field] = value;
  }

  const maxBoostMultiplier = Number(values.maxBoostMultiplier);
  if (!Number.isFinite(maxBoostMultiplier)) {
    throw new Error('CONFIGURATION_INVALID');
  }

  if (
    settings.xpBase < 1
    || settings.xpStep < 0
    || settings.xpMin < 1
    || settings.xpMax < settings.xpMin
    || settings.xpMax >= 2 ** 48
    || !Number.isSafeInteger(settings.xpBase + settings.xpStep)
    || settings.cooldownSeconds < 0
    || settings.cooldownSeconds > MAX_COOLDOWN_SECONDS
    || maxBoostMultiplier < 1
    || maxBoostMultiplier > MAX_SAFE_XP
    || !Number.isSafeInteger(Math.floor(settings.xpMax * maxBoostMultiplier * maxBoostMultiplier))
  ) {
    throw new Error('CONFIGURATION_INVALID');
  }

  return { ...settings, maxBoostMultiplier };
}
