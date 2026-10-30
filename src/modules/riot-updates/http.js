const RIOT_HOST = 'wildrift.leagueoflegends.com';
const MAX_REDIRECTS = 3;
const MAX_RETRY_AFTER_MS = 120_000;

export const RIOT_BASE_URL = `https://${RIOT_HOST}`;
export const RIOT_LISTING_URLS = Object.freeze({
  'pt-br': `${RIOT_BASE_URL}/pt-br/news/game-updates/`,
  'en-us': `${RIOT_BASE_URL}/en-us/news/game-updates/`,
});

export class RiotHttpError extends Error {
  constructor(message, { status = null, retryable = false, retryAfterMs = null, code = 'RIOT_HTTP_ERROR' } = {}) {
    super(message);
    this.name = 'RiotHttpError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

class Semaphore {
  constructor(limit, queueLimit) {
    this.limit = limit;
    this.queueLimit = queueLimit;
    this.active = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    if (this.waiters.length >= this.queueLimit) {
      throw new RiotHttpError('Fila HTTP cheia.', { code: 'RIOT_HTTP_QUEUE_FULL' });
    }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }
}

const domainSemaphores = new Map();

function domainSemaphore(hostname, { concurrency, queueLimit }) {
  if (!domainSemaphores.has(hostname)) {
    domainSemaphores.set(hostname, new Semaphore(concurrency, queueLimit));
  }
  return domainSemaphores.get(hostname);
}

export function normalizeRiotArticleUrl(value, language) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const acceptedLanguages = language ? [language] : ['pt-br', 'en-us'];
  if (
    url.protocol !== 'https:'
    || url.hostname !== RIOT_HOST
    || url.username
    || url.password
    || url.port
    || !acceptedLanguages.some((item) => url.pathname.startsWith(`/${item}/news/game-updates/`))
  ) {
    return null;
  }
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function retryAfterMilliseconds(response, now) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  const rawMs = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now();
  if (!Number.isFinite(rawMs) || rawMs <= 0) return null;
  return Math.min(rawMs, MAX_RETRY_AFTER_MS);
}

function contentLengthExceeds(response, maxBytes) {
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) && length > maxBytes;
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body) return '';
  if (contentLengthExceeds(response, maxBytes)) {
    await response.body.cancel().catch(() => {});
    throw new RiotHttpError('Resposta oficial excedeu o limite de tamanho.', { code: 'RIOT_RESPONSE_TOO_LARGE' });
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RiotHttpError('Resposta oficial excedeu o limite de tamanho.', { code: 'RIOT_RESPONSE_TOO_LARGE' });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(output);
}

async function discardResponseBody(response) {
  await response.body?.cancel().catch(() => {});
}

function isRetryableError(error) {
  return error?.retryable === true
    || ['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name);
}

export class RiotHttpClient {
  constructor({
    fetchImpl = globalThis.fetch,
    timeoutMs = 12_000,
    maxResponseBytes = 2 * 1024 * 1024,
    maxAttempts = 3,
    concurrencyPerDomain = 2,
    queueLimitPerDomain = 24,
    baseBackoffMs = 500,
    now = () => Date.now(),
    random = Math.random,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    logger = () => {},
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.maxAttempts = Math.min(5, Math.max(1, maxAttempts));
    this.concurrencyPerDomain = concurrencyPerDomain;
    this.queueLimitPerDomain = queueLimitPerDomain;
    this.baseBackoffMs = baseBackoffMs;
    this.now = now;
    this.random = random;
    this.sleep = sleep;
    this.logger = logger;
  }

  async getHtml(value, { cache = null, language } = {}) {
    const normalizedUrl = normalizeRiotArticleUrl(value, language);
    if (!normalizedUrl) {
      throw new RiotHttpError('URL oficial rejeitada pela validação.', { code: 'RIOT_URL_REJECTED' });
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.#requestWithRedirects(normalizedUrl, cache);
        this.logger({ event: 'riot_http_response', status: result.status, host: RIOT_HOST, attempt });
        return result;
      } catch (error) {
        lastError = error;
        const retryable = isRetryableError(error);
        if (!retryable || attempt === this.maxAttempts) break;
        const exponential = Math.min(30_000, this.baseBackoffMs * (2 ** (attempt - 1)));
        const jittered = Math.round(exponential * (0.5 + this.random()));
        const waitMs = error.retryAfterMs ?? jittered;
        this.logger({
          event: 'riot_http_retry',
          attempt,
          status: error.status ?? null,
          code: error.code ?? error.name,
          waitMs,
        });
        await this.sleep(waitMs);
      }
    }
    throw lastError ?? new RiotHttpError('Requisição à Riot falhou.');
  }

  async #requestWithRedirects(initialUrl, cache) {
    let url = initialUrl;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const normalized = normalizeRiotArticleUrl(url);
      if (!normalized) throw new RiotHttpError('Redirecionamento para URL não autorizada.', { code: 'RIOT_REDIRECT_REJECTED' });
      const host = new URL(normalized).hostname;
      const semaphore = domainSemaphore(host, {
        concurrency: this.concurrencyPerDomain,
        queueLimit: this.queueLimitPerDomain,
      });
      const release = await semaphore.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('RIOT_REQUEST_TIMEOUT')), this.timeoutMs);
      try {
        const headers = {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'user-agent': 'JinxRiotUpdatesBot/1.0 (Discord community monitor; respectful polling)',
        };
        if (cache?.etag) headers['if-none-match'] = cache.etag;
        if (cache?.lastModified) headers['if-modified-since'] = cache.lastModified;
        const response = await this.fetchImpl(normalized, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: controller.signal,
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await discardResponseBody(response);
          if (redirectCount === MAX_REDIRECTS) {
            throw new RiotHttpError('Número máximo de redirecionamentos excedido.', { code: 'RIOT_REDIRECT_LIMIT' });
          }
          const location = response.headers.get('location');
          const redirected = location ? new URL(location, normalized).toString() : null;
          if (!redirected || !normalizeRiotArticleUrl(redirected)) {
            throw new RiotHttpError('Redirecionamento para URL não autorizada.', { code: 'RIOT_REDIRECT_REJECTED' });
          }
          url = redirected;
          continue;
        }

        if (response.status === 304) {
          if (typeof cache?.body !== 'string') {
            await discardResponseBody(response);
            throw new RiotHttpError('Resposta 304 sem cópia local do conteúdo.', { status: 304, code: 'RIOT_304_CACHE_MISS' });
          }
          return {
            status: 304,
            url: normalized,
            body: cache.body,
            etag: response.headers.get('etag') ?? cache.etag ?? null,
            lastModified: response.headers.get('last-modified') ?? cache.lastModified ?? null,
            contentType: response.headers.get('content-type') ?? 'text/html; charset=utf-8',
          };
        }

        if (response.status === 429) {
          await discardResponseBody(response);
          throw new RiotHttpError('A Riot aplicou limite temporário de requisições.', {
            status: 429,
            retryable: true,
            retryAfterMs: retryAfterMilliseconds(response, this.now),
            code: 'RIOT_HTTP_429',
          });
        }
        if (response.status >= 500) {
          await discardResponseBody(response);
          throw new RiotHttpError('A fonte oficial respondeu com erro temporário.', {
            status: response.status,
            retryable: true,
            code: `RIOT_HTTP_${response.status}`,
          });
        }
        if (!response.ok) {
          await discardResponseBody(response);
          throw new RiotHttpError('A fonte oficial rejeitou a requisição.', {
            status: response.status,
            code: `RIOT_HTTP_${response.status}`,
          });
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(contentType)) {
          await response.body?.cancel().catch(() => {});
          throw new RiotHttpError('A fonte não respondeu HTML.', { code: 'RIOT_UNEXPECTED_CONTENT_TYPE' });
        }
        const body = await readBoundedBody(response, this.maxResponseBytes);
        return {
          status: response.status,
          url: normalized,
          body,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          contentType,
        };
      } catch (error) {
        if (controller.signal.aborted && error?.code !== 'RIOT_RESPONSE_TOO_LARGE') {
          throw new RiotHttpError('Tempo limite da requisição oficial excedido.', {
            retryable: true,
            code: 'RIOT_HTTP_TIMEOUT',
          });
        }
        throw error;
      } finally {
        clearTimeout(timer);
        release();
      }
    }
    throw new RiotHttpError('Requisição oficial não concluída.');
  }
}
