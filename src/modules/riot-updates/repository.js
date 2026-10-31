import { createHash, randomUUID } from 'node:crypto';

export const RIOT_ARTICLE_COLLECTION = 'riot_articles';
export const RIOT_HTTP_CACHE_COLLECTION = 'riot_http_cache';
export const RIOT_INSPECTION_COLLECTION = 'riot_inspections';
export const RIOT_SCHEDULER_STATE_COLLECTION = 'riot_scheduler_state';
export const RIOT_PUBLICATION_COLLECTION = 'riot_publications';
export const RIOT_PUBLICATION_ITEM_COLLECTION = 'riot_publication_items';
export const RIOT_ERROR_COLLECTION = 'riot_errors';
export const RIOT_SCHEDULER_STATE_ID = 'riot-global';

function collection(database, name) {
  return database.collection(name);
}

export async function initializeRiotRepository(database) {
  await collection(database, RIOT_ARTICLE_COLLECTION).createIndex(
    { canonicalUrl: 1 },
    { name: 'riot_article_canonical_url', unique: true },
  );
  await collection(database, RIOT_ARTICLE_COLLECTION).createIndex(
    { publishedAt: -1, status: 1 },
    { name: 'riot_article_history' },
  );
  await collection(database, RIOT_HTTP_CACHE_COLLECTION).createIndex(
    { url: 1 },
    { name: 'riot_http_cache_url', unique: true },
  );
  await collection(database, RIOT_HTTP_CACHE_COLLECTION).createIndex(
    { updatedAt: 1 },
    { name: 'riot_http_cache_expiry', expireAfterSeconds: 45 * 24 * 60 * 60 },
  );
  await collection(database, RIOT_INSPECTION_COLLECTION).createIndex(
    { startedAt: -1 },
    { name: 'riot_inspection_history' },
  );
  await collection(database, RIOT_PUBLICATION_COLLECTION).createIndex(
    { articleUrl: 1, contentHash: 1, pipeline: 1 },
    { name: 'riot_publication_article_hash_pipeline', unique: true },
  );
  await collection(database, RIOT_PUBLICATION_COLLECTION).createIndex(
    { status: 1, pipeline: 1, nextAttemptAt: 1, createdAt: 1 },
    { name: 'riot_publication_queue' },
  );
  await collection(database, RIOT_PUBLICATION_ITEM_COLLECTION).createIndex(
    { pipeline: 1, itemKey: 1 },
    { name: 'riot_publication_item_dedup', unique: true },
  );
  await collection(database, RIOT_PUBLICATION_ITEM_COLLECTION).createIndex(
    { publicationId: 1, status: 1 },
    { name: 'riot_publication_items_by_job' },
  );
  await collection(database, RIOT_ERROR_COLLECTION).createIndex(
    { createdAt: 1 },
    { name: 'riot_error_expiry', expireAfterSeconds: 30 * 24 * 60 * 60 },
  );
  await collection(database, RIOT_SCHEDULER_STATE_COLLECTION).updateOne(
    { _id: RIOT_SCHEDULER_STATE_ID },
    {
      $setOnInsert: {
        lockOwner: null,
        lockExpiresAt: new Date(0),
        lastScheduledSlots: {},
        releaseCalendarLockOwner: null,
        releaseCalendarLockExpiresAt: new Date(0),
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export function getRiotHttpCache(database, url) {
  return collection(database, RIOT_HTTP_CACHE_COLLECTION).findOne(
    { url },
    { projection: { _id: 0, url: 1, body: 1, etag: 1, lastModified: 1, updatedAt: 1 } },
  );
}

export async function setRiotHttpCache(database, { url, body, etag, lastModified, updatedAt = new Date() }) {
  await collection(database, RIOT_HTTP_CACHE_COLLECTION).updateOne(
    { url },
    {
      $set: { body, etag: etag ?? null, lastModified: lastModified ?? null, updatedAt },
      $setOnInsert: { url },
    },
    { upsert: true },
  );
}

export async function saveDiscoveredArticle(database, article, classification, now = new Date()) {
  const articles = collection(database, RIOT_ARTICLE_COLLECTION);
  const previous = await articles.findOne({ canonicalUrl: article.canonicalUrl });
  const contentChanged = Boolean(previous?.contentHash && previous.contentHash !== article.contentHash);
  const isNew = !previous || !previous.contentHash;
  const revision = previous ? (previous.revision ?? 0) + (contentChanged ? 1 : 0) : 0;
  const status = classification.reviewRequired
    ? 'REVIEW_REQUIRED'
    : (contentChanged || isNew ? 'CLASSIFIED' : (previous?.status ?? 'CLASSIFIED'));
  const document = {
    ...article,
    canonicalUrl: article.canonicalUrl,
    classification,
    contentHash: article.contentHash,
    status,
    reviewRequired: classification.reviewRequired,
    revision,
    firstDiscoveredAt: previous?.firstDiscoveredAt ?? now,
    lastDiscoveredAt: now,
    lastProcessedAt: now,
    ...(contentChanged ? { previousContentHash: previous.contentHash, changedAt: now } : {}),
  };
  await articles.updateOne(
    { canonicalUrl: article.canonicalUrl },
    {
      $set: document,
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  return { isNew, contentChanged, previous, document };
}

export async function recordRiotDiscovery(database, card, now = new Date()) {
  await collection(database, RIOT_ARTICLE_COLLECTION).updateOne(
    { canonicalUrl: card.canonicalUrl },
    {
      $setOnInsert: {
        canonicalUrl: card.canonicalUrl,
        title: card.title,
        summary: card.summary,
        version: null,
        publishedAt: card.publishedAt ? new Date(card.publishedAt) : null,
        language: card.language,
        status: 'DISCOVERED',
        reviewRequired: false,
        revision: 0,
        firstDiscoveredAt: now,
        createdAt: now,
      },
      $set: { lastDiscoveredAt: now },
    },
    { upsert: true },
  );
}

export async function markArticleStatus(database, canonicalUrl, status, fields = {}) {
  await collection(database, RIOT_ARTICLE_COLLECTION).updateOne(
    { canonicalUrl },
    { $set: { status, ...fields, updatedAt: new Date() } },
  );
}

export async function markArticlePipelineStatus(database, canonicalUrl, pipeline, status, fields = {}) {
  if (!['patchNotes', 'updates'].includes(pipeline)) throw new Error('RIOT_PIPELINE_INVALID');
  await collection(database, RIOT_ARTICLE_COLLECTION).updateOne(
    { canonicalUrl },
    { $set: { [`pipelineStates.${pipeline}`]: status, ...fields, updatedAt: new Date() } },
  );
}

export function contentItemKey(item) {
  const normalizedText = String(item.originalText ?? item.description ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
  return createHash('sha256')
    .update(`${item.category}\n${String(item.name ?? '').normalize('NFKC').toLowerCase()}\n${normalizedText}\n${item.image ?? ''}\n${item.revision ?? ''}`)
    .digest('hex');
}

export function publicationId(articleUrl, contentHash, pipeline) {
  return createHash('sha256').update(`${articleUrl}\n${contentHash}\n${pipeline}`).digest('hex').slice(0, 24);
}

export async function queuePublication(database, article, pipeline, items, now = new Date()) {
  const id = publicationId(article.canonicalUrl, article.contentHash, pipeline);
  const publications = collection(database, RIOT_PUBLICATION_COLLECTION);
  const { classification: _classification, revisionChanged: _revisionChanged, ...articleSnapshot } = article;
  const publicationFilter = { articleUrl: article.canonicalUrl, contentHash: article.contentHash, pipeline };
  let publication = await publications.findOne(publicationFilter);
  if (publication && publication.status !== 'DISCOVERED') {
    return { id: publication._id, status: publication.status, items: publication.items ?? [] };
  }
  if (!publication) {
    try {
      await publications.updateOne(
        publicationFilter,
        {
          $setOnInsert: {
            _id: id,
            articleUrl: article.canonicalUrl,
            contentHash: article.contentHash,
            pipeline,
            article: articleSnapshot,
            items: [],
            messageIds: [],
            markers: [],
            status: 'DISCOVERED',
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    publication = await publications.findOne(publicationFilter);
    if (!publication) throw new Error('RIOT_PUBLICATION_INSERT_FAILED');
    if (publication.status !== 'DISCOVERED') {
      return { id: publication._id, status: publication.status, items: publication.items ?? [] };
    }
  }

  const itemCollection = collection(database, RIOT_PUBLICATION_ITEM_COLLECTION);
  const reservedItems = [];
  for (let order = 0; order < items.length; order += 1) {
    const item = items[order];
    const itemKey = contentItemKey(item);
    try {
      await itemCollection.insertOne({
        pipeline,
        itemKey,
        publicationId: id,
        articleUrl: article.canonicalUrl,
        contentHash: article.contentHash,
        category: item.category,
        item,
        order,
        status: 'QUEUED',
        createdAt: now,
      });
      reservedItems.push({ ...item, itemKey });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await itemCollection.findOne({ pipeline, itemKey });
      if (existing?.publicationId === id && existing.status !== 'PUBLISHED') {
        reservedItems.push({ ...existing.item, itemKey });
      }
    }
  }

  const publicationItems = await itemCollection.find({ publicationId: id }).sort({ order: 1 }).toArray();
  const alreadyReserved = publicationItems.filter((item) => item.status !== 'PUBLISHED');
  const allReserved = new Map(reservedItems.map((item) => [item.itemKey, item]));
  for (const item of alreadyReserved) {
    if (item.item && !allReserved.has(item.itemKey)) allReserved.set(item.itemKey, { ...item.item, itemKey: item.itemKey });
  }
  const selectedItems = [...allReserved.values()];
  const allItemsAlreadyPublished = publicationItems.length > 0 && publicationItems.every((item) => item.status === 'PUBLISHED');
  const status = selectedItems.length ? 'QUEUED' : allItemsAlreadyPublished ? 'PUBLISHED' : 'DUPLICATE';
  await publications.updateOne(
    { _id: id, status: 'DISCOVERED' },
    { $set: { items: selectedItems, status, queuedAt: now, updatedAt: now } },
  );
  publication = await publications.findOne({ _id: id });
  return { id, status: publication?.status ?? status, items: publication?.items ?? selectedItems };
}

export function getPublication(database, id) {
  return collection(database, RIOT_PUBLICATION_COLLECTION).findOne({ _id: id });
}

export function getLatestFailedPublication(database, pipeline) {
  return collection(database, RIOT_PUBLICATION_COLLECTION).findOne(
    { pipeline, status: 'FAILED' },
    { sort: { updatedAt: -1 } },
  );
}

export async function reopenFailedPublication(database, id, now = new Date(), maxManualRetries = 3) {
  const publications = collection(database, RIOT_PUBLICATION_COLLECTION);
  const publication = await publications.findOne({ _id: id, status: 'FAILED' });
  if (!publication) return { status: 'NOT_FOUND' };
  const manualRetries = publication.manualRetries ?? 0;
  if (manualRetries >= maxManualRetries) return { status: 'RETRY_LIMIT' };

  const filter = { _id: id, status: 'FAILED' };
  if (publication.manualRetries === undefined) filter.manualRetries = { $exists: false };
  else filter.manualRetries = manualRetries;
  const result = await publications.updateOne(
    filter,
    {
      $set: {
        status: 'QUEUED',
        attempts: 0,
        manualRetries: manualRetries + 1,
        requiresManualApproval: true,
        sendingAt: null,
        failure: null,
        reopenedAt: now,
        updatedAt: now,
      },
      $unset: { nextAttemptAt: '' },
    },
  );
  if (result.modifiedCount !== 1) return { status: 'ALREADY_REOPENED' };
  await updatePublicationItems(database, id, 'QUEUED', { nextAttemptAt: null, reopenedAt: now });
  return { status: 'QUEUED', publication: { ...publication, status: 'QUEUED', manualRetries: manualRetries + 1 } };
}

export async function getNextQueuedPublication(database, pipeline, now = new Date()) {
  return collection(database, RIOT_PUBLICATION_COLLECTION).findOne(
    {
      pipeline,
      status: { $in: ['QUEUED', 'RETRYABLE_FAILURE'] },
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
    },
    { sort: { requiresManualApproval: -1, reopenedAt: -1, createdAt: 1 } },
  );
}

export async function getDuePublicationQueue(database, now = new Date(), limit = 25) {
  return collection(database, RIOT_PUBLICATION_COLLECTION).find({
    status: { $in: ['QUEUED', 'RETRYABLE_FAILURE'] },
    requiresManualApproval: { $ne: true },
    $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
  }, { sort: { createdAt: 1 }, limit }).toArray();
}

export async function updatePublication(database, id, fields) {
  await collection(database, RIOT_PUBLICATION_COLLECTION).updateOne(
    { _id: id },
    { $set: { ...fields, updatedAt: new Date() } },
  );
}

export async function claimPublication(database, id, now = new Date()) {
  const result = await collection(database, RIOT_PUBLICATION_COLLECTION).updateOne(
    {
      _id: id,
      status: { $in: ['QUEUED', 'RETRYABLE_FAILURE'] },
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
    },
    {
      $set: { status: 'SENDING', sendingAt: now, updatedAt: now },
      $inc: { attempts: 1, attemptsTotal: 1 },
      $unset: { requiresManualApproval: '' },
    },
  );
  return result.modifiedCount === 1;
}

export function getStaleSendingPublications(database, olderThan) {
  return collection(database, RIOT_PUBLICATION_COLLECTION).find({
    status: 'SENDING',
    sendingAt: { $lte: olderThan },
  }, { sort: { sendingAt: 1 }, limit: 25 }).toArray();
}

export async function updatePublicationItems(database, id, status, extra = {}) {
  await collection(database, RIOT_PUBLICATION_ITEM_COLLECTION).updateMany(
    { publicationId: id, status: { $ne: 'PUBLISHED' } },
    { $set: { status, ...extra, updatedAt: new Date() } },
  );
}

export async function saveRiotError(database, { scope, code, message, details = null, now = new Date() }) {
  await collection(database, RIOT_ERROR_COLLECTION).insertOne({
    _id: randomUUID(),
    scope,
    code: String(code ?? 'RIOT_ERROR').slice(0, 80),
    message: String(message ?? 'Falha sem detalhes').slice(0, 1000),
    details: details && typeof details === 'object' ? details : null,
    createdAt: now,
  });
}

export async function acquireInspectionLock(database, ownerId, now = new Date(), leaseMs = 5 * 60_000) {
  const result = await collection(database, RIOT_SCHEDULER_STATE_COLLECTION).updateOne(
    {
      _id: RIOT_SCHEDULER_STATE_ID,
      $or: [
        { lockExpiresAt: { $lte: now } },
        { lockOwner: null },
        { lockOwner: { $exists: false } },
      ],
    },
    { $set: { lockOwner: ownerId, lockExpiresAt: new Date(now.getTime() + leaseMs), lockStartedAt: now } },
  );
  return result.modifiedCount === 1;
}

export async function renewInspectionLock(database, ownerId, now = new Date(), leaseMs = 5 * 60_000) {
  const result = await collection(database, RIOT_SCHEDULER_STATE_COLLECTION).updateOne(
    { _id: RIOT_SCHEDULER_STATE_ID, lockOwner: ownerId },
    { $set: { lockExpiresAt: new Date(now.getTime() + leaseMs) } },
  );
  return result.modifiedCount === 1;
}

export async function releaseInspectionLock(database, ownerId) {
  await collection(database, RIOT_SCHEDULER_STATE_COLLECTION).updateOne(
    { _id: RIOT_SCHEDULER_STATE_ID, lockOwner: ownerId },
    { $set: { lockExpiresAt: new Date(0) }, $unset: { lockOwner: '', lockStartedAt: '' } },
  );
}

export async function acquireReleaseCalendarLock(database, ownerId, now = new Date(), leaseMs = 5 * 60_000) {
  const result = await collection(database, RIOT_SCHEDULER_STATE_COLLECTION).updateOne(
    {
      _id: RIOT_SCHEDULER_STATE_ID,
      $or: [
        { releaseCalendarLockExpiresAt: { $lte: now } },
        { releaseCalendarLockOwner: null },
        { releaseCalendarLockOwner: { $exists: false } },
      ],
    },
    {
      $set: {
        releaseCalendarLockOwner: ownerId,
        releaseCalendarLockExpiresAt: new Date(now.getTime() + leaseMs),
        releaseCalendarLockStartedAt: now,
      },
    },
  );
  return result.modifiedCount === 1;
}

export async function releaseReleaseCalendarLock(database, ownerId) {
  await collection(database, RIOT_SCHEDULER_STATE_COLLECTION).updateOne(
    { _id: RIOT_SCHEDULER_STATE_ID, releaseCalendarLockOwner: ownerId },
    {
      $set: { releaseCalendarLockExpiresAt: new Date(0) },
      $unset: { releaseCalendarLockOwner: '', releaseCalendarLockStartedAt: '' },
    },
  );
}

export function getRiotSchedulerState(database) {
  return collection(database, RIOT_SCHEDULER_STATE_COLLECTION).findOne({ _id: RIOT_SCHEDULER_STATE_ID });
}

export async function saveSchedulerState(database, fields) {
  await collection(database, RIOT_SCHEDULER_STATE_COLLECTION).updateOne(
    { _id: RIOT_SCHEDULER_STATE_ID },
    { $set: { ...fields, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function createInspectionRecord(database, { reason, scheduledSlots = [], now = new Date() }) {
  const id = randomUUID();
  await collection(database, RIOT_INSPECTION_COLLECTION).insertOne({
    _id: id,
    reason,
    scheduledSlots,
    startedAt: now,
    status: 'RUNNING',
    counts: { discovered: 0, changed: 0, classified: 0, queued: 0, published: 0, reviewRequired: 0 },
    errors: [],
  });
  return id;
}

export async function finishInspectionRecord(database, id, fields) {
  await collection(database, RIOT_INSPECTION_COLLECTION).updateOne(
    { _id: id },
    { $set: { ...fields, finishedAt: new Date() } },
  );
}

export async function getRecentInspection(database) {
  return collection(database, RIOT_INSPECTION_COLLECTION).findOne({}, { sort: { startedAt: -1 } });
}

export async function getRecentRiotErrors(database, limit = 5) {
  return collection(database, RIOT_ERROR_COLLECTION).find({}, {
    sort: { createdAt: -1 },
    limit,
    projection: { _id: 0, scope: 1, code: 1, message: 1, createdAt: 1 },
  }).toArray();
}

export async function getRecentArticleHistory(database, limit = 80) {
  return collection(database, RIOT_ARTICLE_COLLECTION).find({}, {
    sort: { publishedAt: -1 },
    limit,
    projection: { version: 1, publishedAt: 1 },
  }).toArray();
}

export async function getRiotArticle(database, canonicalUrl) {
  return collection(database, RIOT_ARTICLE_COLLECTION).findOne({ canonicalUrl });
}
