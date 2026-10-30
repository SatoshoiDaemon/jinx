import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MemoryDatabase } from '../test-support/memory-mongo.js';
import { runRiotInspection } from '../src/modules/riot-updates/service.js';
import { RIOT_LISTING_URLS, RiotHttpError } from '../src/modules/riot-updates/http.js';
import { initializeRiotRepository } from '../src/modules/riot-updates/repository.js';

const fixture = (name) => readFile(new URL(`./fixtures/riot/${name}`, import.meta.url), 'utf8');

async function runSourceScenario({ rejectPortugueseListing = false } = {}) {
  const database = new MemoryDatabase();
  await initializeRiotRepository(database);
  const portugueseListing = await fixture('updates-list-pt-br.html');
  const englishListing = portugueseListing.replaceAll('/pt-br/', '/en-us/');
  const portugueseArticle = await fixture('patch-notes-7-3b-pt-br.html');
  const englishArticle = portugueseArticle.replace('lang="pt-br"', 'lang="en-us"');
  const requestedUrls = [];
  const context = {
    database,
    logger: () => {},
    riotHttpClient: {
      async getHtml(url) {
        requestedUrls.push(url);
        if (url === RIOT_LISTING_URLS['pt-br'] && rejectPortugueseListing) {
          throw new RiotHttpError('Falha de listagem simulada.', { status: 503, code: 'TEST_SOURCE_FAILURE' });
        }
        if (url === RIOT_LISTING_URLS['pt-br']) return { status: 200, body: portugueseListing, url };
        if (url === RIOT_LISTING_URLS['en-us']) return { status: 200, body: englishListing, url };
        return { status: 200, body: url.includes('/en-us/') ? englishArticle : portugueseArticle, url };
      },
    },
  };
  const result = await runRiotInspection(context, { reason: 'test', publish: false });
  return { database, requestedUrls, result };
}

test('inspeciona primeiro português, persiste artigos e não publica durante inspeção manual', async () => {
  const { database, requestedUrls, result } = await runSourceScenario();
  assert.equal(requestedUrls[0], RIOT_LISTING_URLS['pt-br']);
  assert.ok(requestedUrls.every((url) => !url.includes('/en-us/')));
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.counts.discovered, 10);
  assert.equal(result.counts.classified, 10);
  assert.equal(database.collection('riot_articles').documents.length, 10);
  assert.equal(database.collection('riot_publications').documents.length, 0);
});

test('usa inglês apenas quando a lista em português falha e registra o fallback', async () => {
  const { database, requestedUrls, result } = await runSourceScenario({ rejectPortugueseListing: true });
  assert.equal(requestedUrls[0], RIOT_LISTING_URLS['pt-br']);
  assert.equal(requestedUrls[1], RIOT_LISTING_URLS['en-us']);
  assert.ok(requestedUrls.slice(2).every((url) => url.includes('/en-us/')));
  assert.equal(result.status, 'SUCCEEDED');
  const state = await database.collection('riot_scheduler_state').findOne({ _id: 'riot-global' });
  assert.equal(state.sourceLanguage, 'en-us');
  assert.equal(state.languageFallbackUsed, true);
  assert.equal(database.collection('riot_publications').documents.length, 0);
});
