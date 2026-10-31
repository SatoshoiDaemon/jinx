import { createHash } from 'node:crypto';
import { RIOT_RELEASE_SCHEDULE_URL } from './http.js';

const MAX_CALENDAR_HTML_BYTES = 2 * 1024 * 1024;
const MONTHS = Object.freeze({
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
});

// Histórico de lançamentos principais publicado no calendário da Riot.
export const VERIFIED_MAJOR_RELEASE_HISTORY = Object.freeze([
  ['7.0', '2026-01-22T00:01:00.000Z'],
  ['7.1', '2026-04-09T00:01:00.000Z'],
  ['7.2', '2026-07-09T00:01:00.000Z'],
  ['7.3', '2026-09-22T00:01:00.000Z'],
].map(([version, releaseAt]) => Object.freeze({ version, releaseAt: new Date(releaseAt) })));

function decodeEntities(value) {
  return String(value ?? '').replace(/&(#(?:x[\da-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/giu, (entity, name) => {
    if (name[0] === '#') {
      const hexadecimal = name[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      } catch {
        return entity;
      }
    }
    return ({ amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' })[name.toLowerCase()] ?? entity;
  });
}

function cellText(html) {
  return decodeEntities(String(html ?? '')
    .replace(/<br\b[^>]*>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' '))
    .trim();
}

function parseOfficialDate(value) {
  const text = cellText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  let year;
  let month;
  let day;
  if (iso) {
    [, year, month, day] = iso;
    year = Number(year);
    month = Number(month) - 1;
    day = Number(day);
  } else {
    const named = /^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/iu.exec(text);
    if (!named) return null;
    month = MONTHS[named[1].toLowerCase()];
    day = Number(named[2]);
    year = Number(named[3]);
  }
  if (!Number.isInteger(month) || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const timestamp = Date.UTC(year, month, day, 0, 1);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date;
}

function compareVersions(left, right) {
  const [leftMajor, leftMinor] = left.split('.').map(Number);
  const [rightMajor, rightMinor] = right.split('.').map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor;
}

export function parseRiotReleaseSchedule(html, {
  sourceUrl = RIOT_RELEASE_SCHEDULE_URL,
  fetchedAt = new Date(),
} = {}) {
  if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > MAX_CALENDAR_HTML_BYTES) {
    throw new Error('RIOT_RELEASE_SCHEDULE_INVALID_SIZE');
  }
  const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/giu)];
  const scheduleHeading = headings.find((match) => cellText(match[1]).toLowerCase() === 'patch release schedule');
  if (!scheduleHeading) throw new Error('RIOT_RELEASE_SCHEDULE_HEADING_MISSING');

  const headingEnd = scheduleHeading.index + scheduleHeading[0].length;
  const nextHeading = headings.find((match) => match.index > scheduleHeading.index);
  const tableStart = html.indexOf('<table', headingEnd);
  if (tableStart < 0 || (nextHeading && tableStart > nextHeading.index)) {
    throw new Error('RIOT_RELEASE_SCHEDULE_TABLE_MISSING');
  }
  const tableMatch = /<table\b[^>]*>([\s\S]*?)<\/table>/iu.exec(html.slice(tableStart));
  if (!tableMatch) throw new Error('RIOT_RELEASE_SCHEDULE_TABLE_INVALID');

  const rows = [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)];
  const cellsByRow = rows.map((row) => [...row[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/giu)]
    .map((cell) => cellText(cell[2])));
  const header = cellsByRow[0]?.join(' ') ?? '';
  if (!/00:01\s*UTC/iu.test(header)) throw new Error('RIOT_RELEASE_SCHEDULE_TIMEZONE_UNRECOGNIZED');

  const releaseDates = [];
  for (const cells of cellsByRow.slice(1)) {
    const version = cells[0]?.trim();
    if (!/^\d+\.\d+$/u.test(version ?? '')) continue;
    const releaseAt = parseOfficialDate(cells[1]);
    if (!releaseAt) throw new Error('RIOT_RELEASE_SCHEDULE_DATE_INVALID');
    releaseDates.push({ version, releaseAt });
  }
  if (!releaseDates.length) throw new Error('RIOT_RELEASE_SCHEDULE_EMPTY');

  releaseDates.sort((left, right) => compareVersions(left.version, right.version));
  const versions = new Set();
  for (let index = 0; index < releaseDates.length; index += 1) {
    const entry = releaseDates[index];
    if (versions.has(entry.version)) throw new Error('RIOT_RELEASE_SCHEDULE_DUPLICATE_VERSION');
    versions.add(entry.version);
    if (index > 0 && releaseDates[index - 1].releaseAt >= entry.releaseAt) {
      throw new Error('RIOT_RELEASE_SCHEDULE_DATE_ORDER_INVALID');
    }
  }

  const contentHash = createHash('sha256')
    .update(releaseDates.map(({ version, releaseAt }) => `${version}:${releaseAt.toISOString()}`).join('\n'))
    .digest('hex');
  const checkedAt = new Date(fetchedAt);
  if (!Number.isFinite(checkedAt.getTime())) throw new Error('RIOT_RELEASE_SCHEDULE_CHECK_DATE_INVALID');
  return { sourceUrl, releaseDates, contentHash, checkedAt };
}
