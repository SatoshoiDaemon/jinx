const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Datas de publicação verificadas nas páginas oficiais de game updates.
export const VERIFIED_PATCH_HISTORY = Object.freeze([
  ['7.2', '2026-07-08T09:00:00.000Z'],
  ['7.2a', '2026-07-15T09:00:00.000Z'],
  ['7.2b', '2026-07-29T09:00:00.000Z'],
  ['7.2c', '2026-08-12T09:00:00.000Z'],
  ['7.2d', '2026-08-26T09:00:00.000Z'],
  ['7.2e', '2026-09-09T09:00:00.000Z'],
  ['7.3', '2026-09-21T09:00:00.000Z'],
  ['7.3a', '2026-09-29T09:00:00.000Z'],
  ['7.3b', '2026-10-14T09:00:00.000Z'],
  ['7.3c', '2026-10-21T09:00:00.000Z'],
  ['7.3d', '2026-10-28T09:00:00.000Z'],
].map(([version, publishedAt]) => Object.freeze({ version, publishedAt: new Date(publishedAt) })));

function articleVersion(article) {
  return typeof article?.version === 'string' ? article.version.toLowerCase() : null;
}

function historyFromArticles(articles = []) {
  const known = new Map(VERIFIED_PATCH_HISTORY.map((item) => [item.version, item.publishedAt]));
  for (const article of articles) {
    const version = articleVersion(article);
    const date = article?.publishedAt ? new Date(article.publishedAt) : null;
    if (version && /^\d+\.\d+[a-z]?$/u.test(version) && date && Number.isFinite(date.getTime())) {
      const current = known.get(version);
      if (!current || date > current) known.set(version, date);
    }
  }
  return [...known.entries()]
    .map(([version, publishedAt]) => ({ version, publishedAt }))
    .sort((left, right) => left.publishedAt - right.publishedAt);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dayIntervals(rows) {
  const values = [];
  for (let index = 1; index < rows.length; index += 1) {
    values.push((rows[index].publishedAt - rows[index - 1].publishedAt) / DAY_MS);
  }
  return values.filter((value) => value > 0 && value <= 365);
}

function compareVersions(left, right) {
  const leftMatch = /^(\d+)\.(\d+)([a-z]?)$/u.exec(left);
  const rightMatch = /^(\d+)\.(\d+)([a-z]?)$/u.exec(right);
  if (!leftMatch || !rightMatch) return left.localeCompare(right);
  return Number(leftMatch[1]) - Number(rightMatch[1])
    || Number(leftMatch[2]) - Number(rightMatch[2])
    || leftMatch[3].localeCompare(rightMatch[3]);
}

export function deriveRiotMonitorWindows(articles = [], settings, now = new Date()) {
  const history = historyFromArticles(articles);
  const patchRoots = history.filter((item) => /^(\d+)\.(\d+)$/u.test(item.version));
  const latestRoot = patchRoots.at(-1);
  const latestMinorRows = latestRoot
    ? history
      .filter((item) => item.version.startsWith(`${latestRoot.version}`) && /[a-z]$/u.test(item.version))
      .sort((left, right) => compareVersions(left.version, right.version))
    : [];
  const recentMinorRows = latestMinorRows.length >= 2
    ? latestMinorRows.slice(-5)
    : history.filter((item) => /[a-z]$/u.test(item.version)).slice(-5);
  const minorCadenceDays = median(dayIntervals(recentMinorRows));
  const majorCadenceDays = median(dayIntervals(patchRoots.slice(-5)));
  const latestMinor = recentMinorRows.at(-1);
  const minorDurationHours = settings?.scheduler?.minorWindow?.durationHours ?? 36;
  const majorDurationHours = settings?.scheduler?.majorWindow?.durationHours ?? 72;

  const minorExpectedAt = latestMinor && minorCadenceDays
    ? new Date(latestMinor.publishedAt.getTime() + minorCadenceDays * DAY_MS)
    : null;
  const latestMajor = patchRoots.at(-1);
  const majorExpectedAt = latestMajor && majorCadenceDays
    ? new Date(latestMajor.publishedAt.getTime() + majorCadenceDays * DAY_MS)
    : null;

  return {
    minor: minorExpectedAt
      ? {
        expectedAt: minorExpectedAt,
        startsAt: new Date(minorExpectedAt.getTime() - (minorDurationHours * HOUR_MS) / 2),
        endsAt: new Date(minorExpectedAt.getTime() + (minorDurationHours * HOUR_MS) / 2),
        cadenceDays: minorCadenceDays,
        basedOnVersion: latestMinor.version,
      }
      : null,
    major: majorExpectedAt
      ? {
        expectedAt: majorExpectedAt,
        startsAt: new Date(majorExpectedAt.getTime() - (majorDurationHours * HOUR_MS) / 2),
        endsAt: new Date(majorExpectedAt.getTime() + (majorDurationHours * HOUR_MS) / 2),
        cadenceDays: majorCadenceDays,
        basedOnVersion: latestMajor.version,
      }
      : null,
    history,
    calculatedAt: new Date(now),
  };
}

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/u.exec(String(value ?? ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isoUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function inUtcWindow(date, start, end) {
  const startMinute = parseClock(start);
  const endMinute = parseClock(end);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) return false;
  const currentMinute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return currentMinute >= startMinute && currentMinute <= endMinute;
}

function slotIndex(date, start, intervalMinutes) {
  const startMinute = parseClock(start);
  const currentMinute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return Math.floor((currentMinute - startMinute) / intervalMinutes);
}

export function getDueInspectionSlots({ settings, state = {}, monitorWindows, now = new Date() }) {
  if (!settings?.scheduler?.enabled) return [];
  const due = [];
  const lastInspectionAt = state.lastInspectionAt ? new Date(state.lastInspectionAt) : null;
  const nextAttemptAt = state.nextAttemptAt ? new Date(state.nextAttemptAt) : null;
  if (nextAttemptAt && nextAttemptAt > now) return [];

  if (!lastInspectionAt || now.getTime() - lastInspectionAt.getTime() >= 12 * HOUR_MS) {
    due.push({ kind: 'regular', key: `regular:${Math.floor(now.getTime() / (12 * HOUR_MS))}` });
  }

  const weekday = now.getUTCDay();
  const tuesday = settings.scheduler.tuesday;
  if (weekday === 2 && inUtcWindow(now, tuesday.start, tuesday.end)) {
    const slot = `${isoUtcDate(now)}:${slotIndex(now, tuesday.start, tuesday.intervalMinutes)}`;
    if (state.lastScheduledSlots?.tuesday !== slot) due.push({ kind: 'tuesday', key: `tuesday:${slot}` });
  }

  const wednesday = settings.scheduler.wednesday;
  if (weekday === 3 && inUtcWindow(now, wednesday.start, wednesday.end)) {
    const slot = `${isoUtcDate(now)}:${slotIndex(now, wednesday.start, wednesday.intervalMinutes)}`;
    if (state.lastScheduledSlots?.wednesday !== slot) due.push({ kind: 'wednesday', key: `wednesday:${slot}` });
  }

  for (const kind of ['minor', 'major']) {
    const windowSettings = settings.scheduler[`${kind}Window`];
    if (windowSettings?.enabled === false) continue;
    const window = monitorWindows?.[kind];
    if (!window || now < window.startsAt || now > window.endsAt) continue;
    const intervalMinutes = kind === 'minor' ? 60 : 120;
    const slot = `${window.expectedAt.toISOString()}:${Math.floor((now - window.startsAt) / (intervalMinutes * 60_000))}`;
    if (state.lastScheduledSlots?.[kind] !== slot) due.push({ kind, key: `${kind}:${slot}` });
  }

  return due;
}

export function settingsFromDefaults(settings = {}) {
  return {
    regularIntervalHours: 12,
    ...settings,
    tuesday: { start: '00:01', end: '23:59', intervalMinutes: 60, ...settings.tuesday },
    wednesday: { start: '00:00', end: '02:00', intervalMinutes: 5, ...settings.wednesday },
    minorWindow: { enabled: true, durationHours: 36, ...settings.minorWindow },
    majorWindow: { enabled: true, durationHours: 72, ...settings.majorWindow },
  };
}

export const HOURS_PER_DAY = 24;
