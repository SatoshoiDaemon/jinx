import { randomUUID } from 'node:crypto';
import { classifyRiotArticle } from './classifier.js';
import { deriveRiotMonitorWindows, getDueInspectionSlots } from './calendar.js';
import { RiotHttpClient, RiotHttpError, RIOT_LISTING_URLS } from './http.js';
import { parseRiotArticle, parseRiotListing } from './parser.js';
import { getRiotSettings, updateRiotSetting } from './settings.js';
import { publishQueuedRiotUpdates, reconcileStaleRiotPublications } from './publisher.js';
import {
  acquireInspectionLock,
  createInspectionRecord,
  finishInspectionRecord,
  getRecentArticleHistory,
  getRiotHttpCache,
  getRiotSchedulerState,
  markArticlePipelineStatus,
  markArticleStatus,
  queuePublication,
  recordRiotDiscovery,
  releaseInspectionLock,
  renewInspectionLock,
  saveDiscoveredArticle,
  saveRiotError,
  saveSchedulerState,
  setRiotHttpCache,
} from './repository.js';

const MAX_ARTICLES_PER_INSPECTION = 12;
const FIRST_ACTIVATION_RECENT_ARTICLES = 3;
const MAX_AUTO_PUBLISH_PER_INSPECTION = 5;
const LOCK_HEARTBEAT_MS = 60_000;
const LOCK_LEASE_MS = 5 * 60_000;

const localRuns = new WeakSet();

function log(context, level, event, fields = {}) {
  const record = { level, event, at: new Date().toISOString(), ...fields };
  if (typeof context.logger === 'function') context.logger(record);
  else console[level === 'error' ? 'error' : 'info'](JSON.stringify(record));
}

function articleFallbackUrl(canonicalUrl) {
  const url = new URL(canonicalUrl);
  if (!url.pathname.startsWith('/pt-br/')) return null;
  url.pathname = url.pathname.replace(/^\/pt-br\//u, '/en-us/');
  return url.toString();
}

async function loadHtml(context, url, language) {
  const http = context.riotHttpClient ??= new RiotHttpClient({
    logger: (event) => log(context, 'info', event.event, event),
  });
  const cache = await getRiotHttpCache(context.database, url);
  try {
    const response = await http.getHtml(url, { cache, language });
    if (response.status !== 304) {
      await setRiotHttpCache(context.database, {
        url,
        body: response.body,
        etag: response.etag,
        lastModified: response.lastModified,
      });
    }
    return { body: response.body, status: response.status, url: response.url };
  } catch (error) {
    if (error?.code !== 'RIOT_304_CACHE_MISS') throw error;
    const response = await http.getHtml(url, { language });
    await setRiotHttpCache(context.database, {
      url,
      body: response.body,
      etag: response.etag,
      lastModified: response.lastModified,
    });
    return { body: response.body, status: response.status, url: response.url };
  }
}

async function fetchListing(context, settings) {
  const preferred = settings.preferredLanguage;
  const preferredUrl = RIOT_LISTING_URLS[preferred];
  try {
    const response = await loadHtml(context, preferredUrl, preferred);
    const cards = parseRiotListing(response.body, preferred);
    if (!cards.length) throw new RiotHttpError('A lista oficial não continha artigos reconhecíveis.', { code: 'RIOT_LISTING_EMPTY' });
    return { cards, language: preferred, fallbackUsed: false };
  } catch (preferredError) {
    if (preferred !== 'pt-br' || !settings.fallbackEnglish) throw preferredError;
    const fallback = await loadHtml(context, RIOT_LISTING_URLS['en-us'], 'en-us');
    const cards = parseRiotListing(fallback.body, 'en-us');
    if (!cards.length) throw new RiotHttpError('A lista inglesa oficial não continha artigos reconhecíveis.', { code: 'RIOT_LISTING_EMPTY' });
    log(context, 'info', 'riot_language_fallback', {
      requestedLanguage: preferred,
      selectedLanguage: 'en-us',
      reason: preferredError?.code ?? preferredError?.status ?? preferredError?.name,
    });
    return { cards, language: 'en-us', fallbackUsed: true };
  }
}

async function fetchArticle(context, card, listingLanguage, settings) {
  try {
    return await loadHtml(context, card.canonicalUrl, listingLanguage);
  } catch (error) {
    const fallbackUrl = settings.fallbackEnglish && listingLanguage === 'pt-br' && error?.status === 404
      ? articleFallbackUrl(card.canonicalUrl)
      : null;
    if (!fallbackUrl) throw error;
    return loadHtml(context, fallbackUrl, 'en-us');
  }
}

function streamNeedsBaseline(stream) {
  return stream.enabled && !stream.baselineCompletedAt;
}

export function shouldSkipRiotArticlePipeline(previousStatus, stream, revisionChanged = false) {
  return !streamNeedsBaseline(stream)
    && !revisionChanged
    && ['BASELINED', 'DISABLED'].includes(previousStatus);
}

function shouldQueueFirstActivation(settings, pipeline, cardIndex) {
  const stream = settings[pipeline];
  if (!streamNeedsBaseline(stream)) return true;
  return settings.firstActivationPolicy === 'publish_recent' && cardIndex < FIRST_ACTIVATION_RECENT_ARTICLES;
}

export function buildRiotRetificationItem(article) {
  return {
    id: `${article.canonicalUrl}#ARTICLE_RETIFICATION#${article.revision}`,
    category: 'ARTICLE_RETIFICATION',
    categories: ['ARTICLE_RETIFICATION'],
    name: 'Retificação do artigo oficial',
    classification: null,
    description: 'A Riot alterou este artigo depois da publicação anterior. Consulte o conteúdo atualizado na fonte oficial.',
    originalText: `${article.title}\n${article.summary}\nrevision:${article.revision}`,
    sectionTitle: 'Retificação',
    image: article.heroImage,
    skills: [],
    values: [],
    sourceArticle: article.canonicalUrl,
    version: article.version,
    publishedAt: article.publishedAt,
    language: article.language,
    revision: article.revision,
    reviewRequired: false,
  };
}

async function queueArticlePipelines(context, article, classification, settings, cardIndex, counts, previousArticle = null) {
  let anyQueued = false;
  for (const pipeline of ['patchNotes', 'updates']) {
    const stream = settings[pipeline];
    const items = [...classification[pipeline]];
    if (!stream.enabled) {
      await markArticlePipelineStatus(context.database, article.canonicalUrl, pipeline, 'DISABLED');
      continue;
    }
    if (shouldSkipRiotArticlePipeline(previousArticle?.pipelineStates?.[pipeline], stream, article.revisionChanged)) {
      continue;
    }
    if (streamNeedsBaseline(stream) && !shouldQueueFirstActivation(settings, pipeline, cardIndex)) {
      await markArticlePipelineStatus(context.database, article.canonicalUrl, pipeline, 'BASELINED');
      continue;
    }
    if (article.revisionChanged && items.length) {
      items.push(buildRiotRetificationItem(article));
    }
    if (!items.length) {
      await markArticlePipelineStatus(context.database, article.canonicalUrl, pipeline, 'NO_MATCH');
      continue;
    }
    const queued = await queuePublication(context.database, article, pipeline, items);
    await markArticlePipelineStatus(context.database, article.canonicalUrl, pipeline, queued.status);
    if (queued.status === 'QUEUED') {
      anyQueued = true;
      counts.queued += 1;
    }
  }
  if (anyQueued) await markArticleStatus(context.database, article.canonicalUrl, 'QUEUED');
}

async function saveParsingReview(context, card, error, counts) {
  const now = new Date();
  await context.database.collection('riot_articles').updateOne(
    { canonicalUrl: card.canonicalUrl },
    {
      $set: {
        canonicalUrl: card.canonicalUrl,
        title: card.title,
        summary: card.summary,
        language: card.language,
        publishedAt: card.publishedAt ? new Date(card.publishedAt) : null,
        status: 'REVIEW_REQUIRED',
        reviewRequired: true,
        reviewError: String(error?.message ?? 'Falha de parsing').slice(0, 500),
        lastProcessedAt: now,
      },
      $setOnInsert: { firstDiscoveredAt: now, createdAt: now, revision: 0 },
    },
    { upsert: true },
  );
  counts.reviewRequired += 1;
  await saveRiotError(context.database, {
    scope: 'parser',
    code: error?.code ?? error?.name ?? 'RIOT_PARSE_ERROR',
    message: error?.message ?? 'Falha de parsing sem detalhes.',
    details: { canonicalUrl: card.canonicalUrl, title: card.title },
  });
}

async function updateBaselineAfterScan(context, settings, finishedAt) {
  for (const pipeline of ['patchNotes', 'updates']) {
    if (streamNeedsBaseline(settings[pipeline])) {
      await updateRiotSetting(context.database, `${pipeline}.baselineCompletedAt`, finishedAt);
      settings[pipeline].baselineCompletedAt = finishedAt;
    }
  }
}

function mergeScheduledSlots(previous = {}, slots = []) {
  const merged = { ...previous };
  for (const slot of slots) {
    const separator = slot.key.indexOf(':');
    const kind = slot.key.slice(0, separator);
    const value = slot.key.slice(separator + 1);
    if (['tuesday', 'wednesday', 'minor', 'major'].includes(kind)) merged[kind] = value;
  }
  return merged;
}

export async function runRiotInspection(context, {
  reason = 'manual',
  publish = false,
  scheduledSlots = [],
  now = new Date(),
} = {}) {
  const database = context.database;
  if (localRuns.has(database)) return { status: 'BUSY', counts: null };
  localRuns.add(database);
  const ownerId = randomUUID();
  let locked;
  try {
    locked = await acquireInspectionLock(database, ownerId, now, LOCK_LEASE_MS);
  } catch (error) {
    localRuns.delete(database);
    throw error;
  }
  if (!locked) {
    localRuns.delete(database);
    log(context, 'info', 'riot_inspection_skipped', { reason, status: 'LOCKED' });
    return { status: 'BUSY', counts: null };
  }

  const startedAt = new Date(now);
  let inspectionId;
  try {
    inspectionId = await createInspectionRecord(database, { reason, scheduledSlots, now: startedAt });
  } catch (error) {
    await releaseInspectionLock(database, ownerId).catch(() => {});
    localRuns.delete(database);
    throw error;
  }
  const counts = { discovered: 0, changed: 0, classified: 0, queued: 0, published: 0, reviewRequired: 0 };
  const errors = [];
  const timer = setInterval(() => {
    void renewInspectionLock(database, ownerId, new Date(), LOCK_LEASE_MS).catch((error) => {
      log(context, 'error', 'riot_lock_renewal_failed', { code: error?.code ?? error?.name });
    });
  }, LOCK_HEARTBEAT_MS);
  timer.unref?.();

  try {
    const settings = await getRiotSettings(database);
    const listing = await fetchListing(context, settings);
    const cards = listing.cards.slice(0, MAX_ARTICLES_PER_INSPECTION);
    counts.discovered = cards.length;

    for (let index = 0; index < cards.length; index += 1) {
      const card = { ...cards[index], language: listing.language };
      await recordRiotDiscovery(database, card, startedAt);
      try {
        const page = await fetchArticle(context, card, listing.language, settings);
        const article = parseRiotArticle(page.body, page.url);
        const classification = classifyRiotArticle(article);
        const saved = await saveDiscoveredArticle(database, article, classification, startedAt);
        if (saved.isNew) counts.classified += 1;
        if (saved.contentChanged) counts.changed += 1;
        if (classification.reviewRequired) counts.reviewRequired += 1;
        await queueArticlePipelines(context, {
          ...article,
          revision: saved.document.revision,
          previousContentHash: saved.document.previousContentHash ?? null,
          revisionChanged: saved.contentChanged,
        }, classification, settings, index, counts, saved.previous);
      } catch (error) {
        errors.push({ canonicalUrl: card.canonicalUrl, code: error?.code ?? error?.name ?? 'RIOT_ARTICLE_ERROR' });
        await saveParsingReview(context, card, error, counts);
        log(context, 'error', 'riot_article_processing_failed', {
          canonicalUrl: card.canonicalUrl,
          code: error?.code ?? error?.name ?? 'RIOT_ARTICLE_ERROR',
        });
      }
    }

    const finishedAt = new Date();
    if (!errors.length) await updateBaselineAfterScan(context, settings, finishedAt);
    const publicationResults = publish
      ? await publishQueuedRiotUpdates(context, { limit: MAX_AUTO_PUBLISH_PER_INSPECTION })
      : [];
    counts.published = publicationResults.filter((result) => result.status === 'PUBLISHED').length;
    const status = errors.length ? 'PARTIAL' : 'SUCCEEDED';
    const state = await getRiotSchedulerState(database);
    await saveSchedulerState(database, {
      lastAttemptAt: finishedAt,
      ...(errors.length ? { lastError: errors[0], nextAttemptAt: new Date(finishedAt.getTime() + 5 * 60_000) } : {
        lastInspectionAt: finishedAt,
        lastError: null,
        nextAttemptAt: null,
        lastScheduledSlots: mergeScheduledSlots(state?.lastScheduledSlots, scheduledSlots),
      }),
      lastInspectionId: inspectionId,
      lastInspectionStatus: status,
      lastInspectionCounts: counts,
      lastInspectionDurationMs: finishedAt.getTime() - startedAt.getTime(),
      sourceLanguage: listing.language,
      languageFallbackUsed: listing.fallbackUsed,
      memoryUsedBytes: process.memoryUsage().heapUsed,
    });
    await finishInspectionRecord(database, inspectionId, {
      status,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      counts,
      errors,
      sourceLanguage: listing.language,
      languageFallbackUsed: listing.fallbackUsed,
      publishedCount: counts.published,
    });
    log(context, 'info', 'riot_inspection_finished', {
      inspectionId,
      reason,
      status,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      counts,
      errors: errors.length,
      memoryUsedBytes: process.memoryUsage().heapUsed,
    });
    return { status, inspectionId, counts, errors, publicationResults };
  } catch (error) {
    const finishedAt = new Date();
    const code = error?.code ?? error?.name ?? 'RIOT_INSPECTION_ERROR';
    const message = String(error?.message ?? 'Falha de inspeção').slice(0, 500);
    await saveRiotError(database, { scope: 'inspection', code, message, details: { inspectionId, reason } });
    await saveSchedulerState(database, {
      lastAttemptAt: finishedAt,
      nextAttemptAt: new Date(finishedAt.getTime() + 5 * 60_000),
      lastError: { code, message, at: finishedAt },
      lastInspectionId: inspectionId,
      lastInspectionStatus: 'FAILED',
      lastInspectionDurationMs: finishedAt.getTime() - startedAt.getTime(),
      memoryUsedBytes: process.memoryUsage().heapUsed,
    });
    await finishInspectionRecord(database, inspectionId, {
      status: 'FAILED',
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      counts,
      errors: [{ code, message }],
    });
    log(context, 'error', 'riot_inspection_failed', { inspectionId, reason, code, durationMs: finishedAt.getTime() - startedAt.getTime() });
    return { status: 'FAILED', inspectionId, counts, errors: [{ code, message }] };
  } finally {
    clearInterval(timer);
    await releaseInspectionLock(database, ownerId).catch((error) => {
      log(context, 'error', 'riot_lock_release_failed', { code: error?.code ?? error?.name });
    });
    localRuns.delete(database);
  }
}

export async function runRiotManualInspection(context) {
  const plan = await getRiotSchedulerPlan(context);
  const scheduledSlots = getDueInspectionSlots({
    settings: plan.settings,
    state: plan.state,
    monitorWindows: plan.monitorWindows,
    now: plan.now,
  });
  return runRiotInspection(context, { reason: 'manual', publish: false, scheduledSlots });
}

export async function getRiotSchedulerPlan(context, now = new Date()) {
  const settings = await getRiotSettings(context.database);
  const articles = await getRecentArticleHistory(context.database, 80);
  const monitorWindows = deriveRiotMonitorWindows(articles, settings, now);
  const state = await getRiotSchedulerState(context.database);
  return { settings, articles, monitorWindows, state, now };
}

export async function getRiotSourceHealth(context) {
  const plan = await getRiotSchedulerPlan(context);
  const state = plan.state ?? {};
  const recentErrors = await context.database.collection('riot_errors').find({}, {
    sort: { createdAt: -1 }, limit: 5,
    projection: { _id: 0, scope: 1, code: 1, message: 1, createdAt: 1 },
  }).toArray();
  return {
    lastInspectionAt: state.lastInspectionAt ?? null,
    lastInspectionStatus: state.lastInspectionStatus ?? 'Nunca executada',
    lastInspectionDurationMs: state.lastInspectionDurationMs ?? null,
    lastInspectionCounts: state.lastInspectionCounts ?? null,
    lastPublicationAt: state.lastPublicationAt ?? null,
    lastPublicationPipeline: state.lastPublicationPipeline ?? null,
    lastError: state.lastError ?? null,
    recentErrors,
    monitorWindows: plan.monitorWindows,
  };
}

export async function recoverRiotState(context) {
  return reconcileStaleRiotPublications(context);
}
