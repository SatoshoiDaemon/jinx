import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_RIOT_UPDATES_SETTINGS } from '../src/config/defaults.js';
import { deriveRiotMonitorWindows } from '../src/modules/riot-updates/calendar.js';
import { RIOT_RELEASE_SCHEDULE_URL } from '../src/modules/riot-updates/http.js';
import { parseRiotReleaseSchedule, VERIFIED_MAJOR_RELEASE_HISTORY } from '../src/modules/riot-updates/release-calendar.js';
import { syncOfficialRiotReleaseSchedule } from '../src/modules/riot-updates/service.js';
import {
  acquireReleaseCalendarLock,
  initializeRiotRepository,
  releaseReleaseCalendarLock,
  saveSchedulerState,
} from '../src/modules/riot-updates/repository.js';
import { MemoryDatabase } from '../test-support/memory-mongo.js';

const fixture = () => readFile(new URL('./fixtures/riot/patch-schedule-en-us.html', import.meta.url), 'utf8');

test('extrai somente datas oficiais de versões principais em 00:01 UTC', async () => {
  const parsed = parseRiotReleaseSchedule(await fixture(), { fetchedAt: new Date('2026-10-31T00:00:00Z') });
  assert.equal(parsed.sourceUrl, RIOT_RELEASE_SCHEDULE_URL);
  assert.deepEqual(parsed.releaseDates.map(({ version }) => version), ['7.0', '7.1', '7.2', '7.3']);
  assert.equal(parsed.releaseDates[0].releaseAt.toISOString(), '2026-01-22T00:01:00.000Z');
  assert.equal(parsed.releaseDates.at(-1).releaseAt.toISOString(), '2026-09-22T00:01:00.000Z');
  assert.equal(parsed.releaseDates.some(({ version }) => /[a-z]$/u.test(version)), false);
  assert.equal(parsed.checkedAt.toISOString(), '2026-10-31T00:00:00.000Z');
});

test('rejeita calendário com fuso ausente, datas malformadas ou versões fora de ordem', async () => {
  const html = await fixture();
  assert.throws(() => parseRiotReleaseSchedule(html.replace('Date (00:01 UTC)', 'Date')), { message: 'RIOT_RELEASE_SCHEDULE_TIMEZONE_UNRECOGNIZED' });
  assert.throws(() => parseRiotReleaseSchedule(html.replace('September 22, 2026', 'Soon')), { message: 'RIOT_RELEASE_SCHEDULE_DATE_INVALID' });
  assert.throws(() => parseRiotReleaseSchedule(html.replace('April 9, 2026', 'January 9, 2026')), { message: 'RIOT_RELEASE_SCHEDULE_DATE_ORDER_INVALID' });
  assert.throws(() => parseRiotReleaseSchedule('<html><h1>Unexpected page</h1></html>'), { message: 'RIOT_RELEASE_SCHEDULE_HEADING_MISSING' });
});

test('usa uma data oficial futura para versões principais e mantém projeções de notas separadas', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  const releaseSchedule = [
    ...VERIFIED_MAJOR_RELEASE_HISTORY,
    { version: '7.4', releaseAt: new Date('2026-12-03T00:01:00Z') },
  ];
  const notes = [{ version: '7.3', publishedAt: new Date('2026-09-21T09:00:00Z') }];
  const windows = deriveRiotMonitorWindows(notes, DEFAULT_RIOT_UPDATES_SETTINGS, now, releaseSchedule);
  assert.equal(windows.major.expectedAt.toISOString(), '2026-12-03T00:01:00.000Z');
  assert.equal(windows.major.basedOnVersion, '7.4');
  assert.equal(windows.major.dateKind, 'version_release');
  assert.equal(windows.major.source, 'official_schedule');
  assert.equal(windows.minor.expectedAt.toISOString(), '2026-11-11T09:00:00.000Z');
  assert.equal(windows.minor.dateKind, 'notes_publication');
  assert.notEqual(windows.major.expectedAt.getTime(), notes[0].publishedAt.getTime());
});

test('sincroniza calendário no MongoDB com deduplicação temporal e preserva data de publicação', async () => {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  const body = await fixture();
  let requests = 0;
  const context = {
    database,
    logger: () => {},
    riotHttpClient: {
      getHtml: async () => {
        requests += 1;
        return { status: 200, url: RIOT_RELEASE_SCHEDULE_URL, body, etag: '"schedule-v1"', lastModified: null };
      },
    },
  };
  const now = new Date('2026-10-31T00:00:00Z');
  const first = await syncOfficialRiotReleaseSchedule(context, { now });
  assert.equal(first.updated, true);
  assert.equal(first.state.officialReleaseSchedule.length, 4);
  assert.equal(first.state.releaseScheduleLastSyncedAt.toISOString(), now.toISOString());
  assert.equal(first.state.releaseScheduleNextSyncAt.toISOString(), '2026-10-31T12:00:00.000Z');
  assert.equal(first.state.officialReleaseSchedule[3].releaseAt.toISOString(), '2026-09-22T00:01:00.000Z');
  assert.equal(Object.hasOwn(first.state.officialReleaseSchedule[3], 'publishedAt'), false);
  assert.equal((await database.collection('riot_http_cache').findOne({ url: RIOT_RELEASE_SCHEDULE_URL })).etag, '"schedule-v1"');

  const second = await syncOfficialRiotReleaseSchedule(context, { now: new Date('2026-10-31T11:59:00Z') });
  assert.equal(second.skipped, true);
  assert.equal(requests, 1);
});

test('lock compartilhado impede duas consultas e pode ser recuperado após a lease', async () => {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  const start = new Date('2026-10-31T00:00:00Z');
  assert.equal(await acquireReleaseCalendarLock(database, 'worker-a', start, 60_000), true);
  assert.equal(await acquireReleaseCalendarLock(database, 'worker-b', start, 60_000), false);
  assert.equal(await acquireReleaseCalendarLock(database, 'worker-b', new Date(start.getTime() + 60_001), 60_000), true);
  await releaseReleaseCalendarLock(database, 'worker-b');
  assert.equal(await acquireReleaseCalendarLock(database, 'worker-c', new Date(start.getTime() + 60_002), 60_000), true);
});

test('falha temporária mantém o último calendário e agenda nova tentativa limitada', async () => {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  await saveSchedulerState(database, {
    officialReleaseSchedule: VERIFIED_MAJOR_RELEASE_HISTORY,
    releaseScheduleContentHash: 'previous-hash',
  });
  const context = {
    database,
    logger: () => {},
    riotHttpClient: { getHtml: async () => { throw Object.assign(new Error('Fonte indisponível'), { code: 'RIOT_HTTP_503', status: 503 }); } },
  };
  const now = new Date('2026-10-31T00:00:00Z');
  const result = await syncOfficialRiotReleaseSchedule(context, { now });
  assert.equal(result.updated, false);
  assert.equal(result.state.officialReleaseSchedule.length, 4);
  assert.equal(result.state.releaseScheduleLastError.code, 'RIOT_HTTP_503');
  assert.equal(result.state.releaseScheduleNextSyncAt.toISOString(), '2026-10-31T12:00:00.000Z');
  assert.equal((await database.collection('riot_errors').find({ scope: 'release_schedule' }).toArray()).length, 1);
});
