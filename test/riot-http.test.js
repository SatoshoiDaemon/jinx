import test from 'node:test';
import assert from 'node:assert/strict';
import { RiotHttpClient, normalizeRiotArticleUrl, normalizeRiotSourceUrl, RIOT_RELEASE_SCHEDULE_URL } from '../src/modules/riot-updates/http.js';

const url = 'https://wildrift.leagueoflegends.com/pt-br/news/game-updates/article/';
const htmlResponse = (body = '<html></html>', headers = {}) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
});

test('aceita apenas URLs HTTPS da lista oficial de atualizações', () => {
  assert.equal(normalizeRiotArticleUrl(url, 'pt-br'), url);
  assert.equal(normalizeRiotArticleUrl('http://wildrift.leagueoflegends.com/pt-br/news/game-updates/a/'), null);
  assert.equal(normalizeRiotArticleUrl('https://wildrift.leagueoflegends.com.evil.test/pt-br/news/game-updates/a/'), null);
  assert.equal(normalizeRiotArticleUrl('https://user@wildrift.leagueoflegends.com/pt-br/news/game-updates/a/'), null);
  assert.equal(normalizeRiotArticleUrl('https://wildrift.leagueoflegends.com/pt-br/news/other/a/'), null);
  assert.equal(normalizeRiotArticleUrl('https://127.0.0.1/pt-br/news/game-updates/a/'), null);
});

test('permite apenas a página fixa de calendário da Riot Support como fonte adicional', () => {
  assert.equal(normalizeRiotSourceUrl(RIOT_RELEASE_SCHEDULE_URL), RIOT_RELEASE_SCHEDULE_URL);
  assert.equal(normalizeRiotSourceUrl(`${RIOT_RELEASE_SCHEDULE_URL}/`), RIOT_RELEASE_SCHEDULE_URL);
  assert.equal(normalizeRiotSourceUrl('https://support.riotgames.com/en-us/wild-rift/events/other'), null);
  assert.equal(normalizeRiotSourceUrl('https://support.riotgames.com.evil.test/en-us/wild-rift/events/wild-rift-patch-schedule'), null);
  assert.equal(normalizeRiotSourceUrl('http://support.riotgames.com/en-us/wild-rift/events/wild-rift-patch-schedule'), null);
  assert.equal(normalizeRiotSourceUrl('https://support.riotgames.com:444/en-us/wild-rift/events/wild-rift-patch-schedule'), null);
});

test('usa ETag e devolve conteúdo armazenado em HTTP 304', async () => {
  let requestHeaders;
  const client = new RiotHttpClient({
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return new Response(null, { status: 304, headers: { etag: '"next"' } });
    },
    maxAttempts: 1,
  });
  const result = await client.getHtml(url, {
    cache: { body: '<html>cached</html>', etag: '"old"', lastModified: 'Wed, 28 Oct 2026 09:00:00 GMT' },
    language: 'pt-br',
  });
  assert.equal(result.status, 304);
  assert.equal(result.body, '<html>cached</html>');
  assert.equal(requestHeaders['if-none-match'], '"old"');
  assert.equal(requestHeaders['if-modified-since'], 'Wed, 28 Oct 2026 09:00:00 GMT');
  assert.equal(result.etag, '"next"');
});

test('segue somente redirecionamento canônico dentro da lista estrita de fontes Riot', async () => {
  let calls = 0;
  const client = new RiotHttpClient({
    fetchImpl: async (url) => {
      calls += 1;
      if (calls === 1) {
        return new Response('', { status: 301, headers: { location: `${url}/` } });
      }
      return htmlResponse('<html>calendar</html>');
    },
    maxAttempts: 1,
  });
  const result = await client.getHtml(RIOT_RELEASE_SCHEDULE_URL);
  assert.equal(calls, 2);
  assert.equal(result.url, RIOT_RELEASE_SCHEDULE_URL);
});

test('retry-after 429 e erro 5xx usam tentativas limitadas e backoff injetável', async () => {
  const waits = [];
  let calls = 0;
  const client = new RiotHttpClient({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '1' } });
      if (calls === 2) return new Response('', { status: 503 });
      return htmlResponse('<html>ok</html>');
    },
    maxAttempts: 3,
    now: () => 0,
    random: () => 0,
    baseBackoffMs: 10,
    sleep: async (milliseconds) => waits.push(milliseconds),
  });
  const result = await client.getHtml(url, { language: 'pt-br' });
  assert.equal(result.body, '<html>ok</html>');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1_000, 10]);
});

test('interrompe respostas acima do limite e converte timeout em erro recuperável', async () => {
  const oversized = new RiotHttpClient({
    fetchImpl: async () => htmlResponse('12345'),
    maxResponseBytes: 4,
    maxAttempts: 1,
  });
  await assert.rejects(oversized.getHtml(url, { language: 'pt-br' }), { code: 'RIOT_RESPONSE_TOO_LARGE' });

  const timedOut = new RiotHttpClient({
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    }),
    timeoutMs: 5,
    maxAttempts: 1,
    sleep: async () => {},
  });
  await assert.rejects(timedOut.getHtml(url, { language: 'pt-br' }), { code: 'RIOT_HTTP_TIMEOUT', retryable: true });
});

test('bloqueia redirecionamentos para domínios internos ou URLs não oficiais', async () => {
  let calls = 0;
  const client = new RiotHttpClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
    },
    maxAttempts: 1,
  });
  await assert.rejects(client.getHtml(url, { language: 'pt-br' }), { code: 'RIOT_REDIRECT_REJECTED' });
  assert.equal(calls, 1);
});

test('limita concorrência HTTP por domínio', async () => {
  let active = 0;
  let peak = 0;
  const client = new RiotHttpClient({
    fetchImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return htmlResponse();
    },
    maxAttempts: 1,
  });
  await Promise.all(Array.from({ length: 5 }, () => client.getHtml(url, { language: 'pt-br' })));
  assert.ok(peak <= 2);
});
