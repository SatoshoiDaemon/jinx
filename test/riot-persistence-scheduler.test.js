import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RIOT_UPDATES_SETTINGS } from '../src/config/defaults.js';
import {
  acquireInspectionLock,
  claimPublication,
  contentItemKey,
  getDuePublicationQueue,
  getNextQueuedPublication,
  getRiotSchedulerState,
  initializeRiotRepository,
  publicationId,
  queuePublication,
  reopenFailedPublication,
  recordRiotDiscovery,
  releaseInspectionLock,
  renewInspectionLock,
  saveDiscoveredArticle,
  updatePublication,
  updatePublicationItems,
  saveSchedulerState,
} from '../src/modules/riot-updates/repository.js';
import { deriveRiotMonitorWindows, getDueInspectionSlots, VERIFIED_PATCH_HISTORY } from '../src/modules/riot-updates/calendar.js';
import { buildRiotRetificationItem } from '../src/modules/riot-updates/service.js';
import { shouldSkipRiotArticlePipeline } from '../src/modules/riot-updates/service.js';
import { MemoryDatabase } from '../test-support/memory-mongo.js';

function item(name = 'Ezreal') {
  return {
    category: 'CHAMPION_BALANCE',
    name,
    originalText: 'Dano de Ataque base: 58 → 60',
    description: 'Dano de Ataque base: 58 → 60',
    values: [{ raw: 'Dano de Ataque base: 58 → 60' }],
  };
}

function article(path, contentHash) {
  return {
    canonicalUrl: `https://wildrift.leagueoflegends.com/pt-br/news/game-updates/${path}/`,
    contentHash,
    title: 'Notas da Atualização 7.3',
    version: '7.3',
    publishedAt: new Date('2026-09-21T09:00:00Z'),
    summary: 'Resumo oficial.',
  };
}

test('deduplica itens entre artigos e não rebaixa uma publicação concluída', async () => {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  const firstArticle = article('patch-a', 'hash-a');
  const first = await queuePublication(database, firstArticle, 'patchNotes', [item()]);
  assert.equal(first.status, 'QUEUED');
  assert.equal(first.id, publicationId(firstArticle.canonicalUrl, firstArticle.contentHash, 'patchNotes'));

  await updatePublication(database, first.id, { status: 'PUBLISHED', messageIds: ['123'] });
  await updatePublicationItems(database, first.id, 'PUBLISHED');
  const repeated = await queuePublication(database, firstArticle, 'patchNotes', [item()]);
  assert.equal(repeated.status, 'PUBLISHED');
  assert.deepEqual(repeated.items, first.items);
  assert.equal((await database.collection('riot_publications').findOne({ _id: first.id })).status, 'PUBLISHED');

  const second = await queuePublication(database, article('patch-b', 'hash-b'), 'patchNotes', [item()]);
  assert.equal(second.status, 'DUPLICATE');
  assert.equal(contentItemKey(item()), contentItemKey({ ...item(), description: '  Dano de Ataque base: 58 → 60\n' }));
  assert.notEqual(contentItemKey(item()), contentItemKey({ ...item(), revision: 1 }));
});

test('promove um registro DISCOVERED para CLASSIFIED e conta o primeiro parsing', async () => {
  const database = new MemoryDatabase();
  const card = {
    canonicalUrl: 'https://wildrift.leagueoflegends.com/pt-br/news/game-updates/new-article/',
    title: 'Notas da Atualização 7.3b',
    summary: 'Resumo oficial',
    publishedAt: '2026-10-14T09:00:00.000Z',
    language: 'pt-br',
  };
  await recordRiotDiscovery(database, card);
  const parsed = await saveDiscoveredArticle(database, {
    ...card,
    version: '7.3b',
    publishedAt: new Date(card.publishedAt),
    contentHash: 'content-hash',
    sections: [],
  }, { reviewRequired: false, patchNotes: [], updates: [] });
  assert.equal(parsed.isNew, true);
  assert.equal(parsed.contentChanged, false);
  assert.equal(parsed.document.status, 'CLASSIFIED');
});

test('preserva publicação recuperável sem reinseri-la na fila inicial', async () => {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  const source = article('patch-a', 'hash-a');
  const queued = await queuePublication(database, source, 'patchNotes', [item()]);
  await updatePublication(database, queued.id, { status: 'RETRYABLE_FAILURE', attempts: 2, nextAttemptAt: new Date('2026-10-31T00:00:00Z') });
  const repeated = await queuePublication(database, source, 'patchNotes', [item()]);
  assert.equal(repeated.status, 'RETRYABLE_FAILURE');
  const stored = await database.collection('riot_publications').findOne({ _id: queued.id });
  assert.equal(stored.attempts, 2);
  assert.equal(stored.nextAttemptAt.toISOString(), '2026-10-31T00:00:00.000Z');
});

test('reabre falha terminal com prévia obrigatória e limite de tentativas administrativas', async () => {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  await queuePublication(database, article('patch-old', 'hash-old'), 'patchNotes', [item('Ahri')]);
  const source = article('patch-a', 'hash-a');
  const queued = await queuePublication(database, source, 'patchNotes', [item()]);
  await updatePublication(database, queued.id, { status: 'FAILED', attempts: 5, failure: { code: 'TEST' } });
  await updatePublicationItems(database, queued.id, 'FAILED');

  const reopened = await reopenFailedPublication(database, queued.id);
  assert.equal(reopened.status, 'QUEUED');
  assert.equal(reopened.publication.manualRetries, 1);
  const autoQueue = await getDuePublicationQueue(database);
  assert.equal(autoQueue.length, 1);
  assert.notEqual(autoQueue[0]._id, queued.id);
  assert.equal((await getNextQueuedPublication(database, 'patchNotes'))._id, queued.id);
  const stored = await database.collection('riot_publications').findOne({ _id: queued.id });
  assert.equal(stored.requiresManualApproval, true);
  assert.equal(stored.attempts, 0);
  assert.equal(await claimPublication(database, queued.id), true);
  assert.equal((await database.collection('riot_publications').findOne({ _id: queued.id })).requiresManualApproval, undefined);

  await updatePublication(database, queued.id, { status: 'FAILED', manualRetries: 3 });
  assert.equal((await reopenFailedPublication(database, queued.id)).status, 'RETRY_LIMIT');
});

test('cria um item explícito de retificação com referência à versão atualizada', () => {
  const notice = buildRiotRetificationItem({
    canonicalUrl: 'https://wildrift.leagueoflegends.com/pt-br/news/game-updates/patch-7-3/',
    title: 'Notas da Atualização 7.3',
    summary: 'Resumo oficial revisado.',
    version: '7.3',
    publishedAt: new Date('2026-09-21T09:00:00Z'),
    language: 'pt-br',
    revision: 2,
    heroImage: null,
  });
  assert.equal(notice.category, 'ARTICLE_RETIFICATION');
  assert.equal(notice.revision, 2);
  assert.match(notice.description, /Riot alterou este artigo/u);
  assert.match(notice.originalText, /revision:2/u);
});

test('não transforma o histórico registrado no primeiro baseline em publicação antiga', () => {
  const activeStream = { enabled: true, baselineCompletedAt: new Date('2026-10-30T00:00:00Z') };
  assert.equal(shouldSkipRiotArticlePipeline('BASELINED', activeStream), true);
  assert.equal(shouldSkipRiotArticlePipeline('DISABLED', activeStream), true);
  assert.equal(shouldSkipRiotArticlePipeline('BASELINED', activeStream, true), false);
  assert.equal(shouldSkipRiotArticlePipeline('BASELINED', { enabled: true, baselineCompletedAt: null }), false);
});

test('serializa locks de inspeção e recupera após expiração ou liberação', async () => {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  const start = new Date('2026-11-03T00:01:00Z');
  assert.equal(await acquireInspectionLock(database, 'worker-a', start, 60_000), true);
  assert.equal(await acquireInspectionLock(database, 'worker-b', start, 60_000), false);
  assert.equal(await renewInspectionLock(database, 'worker-a', new Date(start.getTime() + 30_000), 60_000), true);
  assert.equal(await acquireInspectionLock(database, 'worker-b', new Date(start.getTime() + 90_001), 60_000), true);
  await releaseInspectionLock(database, 'worker-b');
  assert.equal(await acquireInspectionLock(database, 'worker-c', new Date(start.getTime() + 91_000), 60_000), true);
});

test('recupera estado do scheduler persistido após reinicialização', async () => {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  const finishedAt = new Date('2026-11-03T00:01:00Z');
  await saveSchedulerState(database, {
    lastInspectionAt: finishedAt,
    lastScheduledSlots: { tuesday: '2026-11-03:0' },
    lastInspectionStatus: 'SUCCEEDED',
  });

  const stateAfterRestart = await getRiotSchedulerState(database);
  assert.equal(stateAfterRestart.lastInspectionAt.toISOString(), finishedAt.toISOString());
  assert.deepEqual(getDueInspectionSlots({
    settings: { ...structuredClone(DEFAULT_RIOT_UPDATES_SETTINGS), scheduler: { ...structuredClone(DEFAULT_RIOT_UPDATES_SETTINGS.scheduler), enabled: true } },
    state: stateAfterRestart,
    now: finishedAt,
    monitorWindows: { minor: null, major: null },
  }), []);
});

test('usa histórico verificado e evita varrer sem ativação administrativa', () => {
  const settings = structuredClone(DEFAULT_RIOT_UPDATES_SETTINGS);
  assert.equal(VERIFIED_PATCH_HISTORY.at(-1).version, '7.3d');
  const windows = deriveRiotMonitorWindows([], settings, new Date('2026-10-30T00:00:00Z'));
  assert.equal(windows.minor.basedOnVersion, '7.3d');
  assert.equal(windows.minor.cadenceDays, 7);
  assert.equal(windows.minor.expectedAt.toISOString(), '2026-11-04T09:00:00.000Z');
  assert.equal(windows.major.cadenceDays, 75);
  assert.equal(windows.major.expectedAt.toISOString(), '2026-12-05T09:00:00.000Z');

  const now = new Date('2026-11-03T00:01:00Z');
  assert.deepEqual(getDueInspectionSlots({ settings, now }), []);
  settings.scheduler.enabled = true;
  const overlap = getDueInspectionSlots({
    settings,
    now,
    state: { lastInspectionAt: new Date('2026-11-01T00:00:00Z') },
    monitorWindows: { minor: null, major: null },
  });
  assert.deepEqual(overlap.map((slot) => slot.kind), ['regular', 'tuesday']);

  const sameWindow = getDueInspectionSlots({
    settings,
    now: new Date('2026-11-04T00:00:00Z'),
    state: { lastInspectionAt: new Date('2026-11-04T00:00:00Z'), lastScheduledSlots: { wednesday: '2026-11-04:0' } },
    monitorWindows: { minor: null, major: null },
  });
  assert.deepEqual(sameWindow, []);
});
