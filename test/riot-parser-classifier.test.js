import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRiotArticle, parseRiotListing } from '../src/modules/riot-updates/parser.js';
import { classifyRiotArticle } from '../src/modules/riot-updates/classifier.js';

const fixture = (name) => readFile(new URL(`./fixtures/riot/${name}`, import.meta.url), 'utf8');
const articleUrl = (slug) => `https://wildrift.leagueoflegends.com/pt-br/news/game-updates/${slug}/`;

test('lê cards oficiais da lista pt-BR com URL, data e resumo', async () => {
  const cards = parseRiotListing(await fixture('updates-list-pt-br.html'), 'pt-br');
  assert.equal(cards.length, 10);
  assert.ok(cards.every((card) => card.canonicalUrl.startsWith('https://wildrift.leagueoflegends.com/pt-br/news/game-updates/')));
  assert.ok(cards.every((card) => card.title.length > 0 && card.publishedAt));
  assert.ok(cards.some((card) => /7\.3b/u.test(card.title)));
});

test('preserva o artigo real 7.3b, campeões, habilidades e valores publicados', async () => {
  const article = parseRiotArticle(await fixture('patch-notes-7-3b-pt-br.html'), articleUrl('patch-notes-7-3b'));
  assert.equal(article.version, '7.3b');
  assert.equal(article.language, 'pt-br');
  assert.equal(article.publishedAt.toISOString(), '2026-10-14T09:00:00.000Z');

  const volibear = article.sections.flatMap((section) => section.characters).find((champion) => champion.name === 'VOLIBEAR');
  assert.ok(volibear);
  assert.ok(volibear.skills.some((skill) => skill.name === 'Fúria Selvagem'));
  assert.ok(volibear.skills.flatMap((skill) => skill.values).some((change) => (
    change.raw === 'Multiplicador de Dano de Ataque: 100% → 110%'
    && change.before === '100%'
    && change.after === '110%'
  )));
});

test('classifica seções de balanceamento e novidades separadamente no artigo misto 7.3', async () => {
  const article = parseRiotArticle(await fixture('patch-notes-7-3-pt-br.html'), articleUrl('patch-notes-7-3'));
  const classified = classifyRiotArticle(article);

  assert.equal(article.version, '7.3');
  assert.ok(classified.patchNotes.some((item) => item.category === 'CHAMPION_BALANCE' && item.name === 'Garen'));
  assert.ok(classified.patchNotes.some((item) => item.category === 'ITEM_BALANCE'));
  assert.ok(classified.patchNotes.some((item) => item.category === 'RUNE_BALANCE'));
  assert.ok(classified.patchNotes.some((item) => item.category === 'SYSTEM_BALANCE'));
  assert.ok(classified.updates.some((item) => item.category === 'NEW_CHAMPION' && item.name === 'Hwei'));
  assert.ok(classified.updates.some((item) => item.category === 'BATTLE_PASS'));
  assert.ok(classified.updates.some((item) => item.category === 'EVENT'));
  assert.ok(classified.updates.some((item) => item.category === 'GAME_MODE'));
  assert.ok(classified.updates.some((item) => item.categories.includes('SKIN_RELEASE')));
  assert.ok(classified.updates.some((item) => item.category === 'MAJOR_ANNOUNCEMENT'));
  assert.equal(classified.reviewRequired, false);

  const championNames = classified.patchNotes
    .filter((item) => item.category === 'CHAMPION_BALANCE')
    .map((item) => item.name.normalize('NFKC').toLowerCase());
  assert.equal(new Set(championNames).size, championNames.length);
  assert.ok(classified.patchNotes.every((item) => !['NEW_CHAMPION', 'SKIN_RELEASE', 'EVENT', 'GAME_MODE', 'BATTLE_PASS'].includes(item.category)));
  assert.ok(classified.updates.every((item) => !['CHAMPION_BALANCE', 'ITEM_BALANCE', 'RUNE_BALANCE', 'SYSTEM_BALANCE'].includes(item.category)));
});

test('mantém uma seção não interpretada para revisão em vez de classificar por suposição', async () => {
  const article = parseRiotArticle(await fixture('patch-notes-7-3b-pt-br.html'), articleUrl('patch-notes-7-3b'));
  const classified = classifyRiotArticle(article);
  assert.equal(classified.reviewRequired, true);
  assert.ok(classified.reviewRequiredSections.some((section) => section.originalText.length > 0));
});

test('rejeita canonical e imagens fora dos domínios oficiais', () => {
  const html = '<html lang="pt-br"><head><link rel="canonical" href="https://127.0.0.1/private"></head><body></body></html>';
  assert.throws(() => parseRiotArticle(html, articleUrl('unsafe')), /RIOT_ARTICLE_CANONICAL_URL_INVALID/u);
  const untrustedImageHtml = `<html lang="pt-br"><head><link rel="canonical" href="${articleUrl('unsafe-image')}"><meta property="og:image" content="https://127.0.0.1/private.png"></head><body><h1 data-testid="title">Notas da Atualização 7.3</h1><section data-testid="ArticleRichTextBlade" id="overview"></section></body></html>`;
  const article = parseRiotArticle(untrustedImageHtml, articleUrl('unsafe-image'));
  assert.equal(article.heroImage, null);
  assert.deepEqual(article.images, []);
});

test('associa imagens oficiais à subseção correta e ignora imagens externas', () => {
  const url = articleUrl('image-test');
  const html = `<html lang="pt-br"><head><link rel="canonical" href="${url}"></head><body><h1 data-testid="title">Notas da Atualização 7.3</h1><section data-testid="ArticleRichTextBlade" id="EVENTS"><div data-testid="blade-content"><h2>Festival de Batalhas</h2><p>Evento com lançamento anunciado.<img src="https://cmsassets.rgpub.io/event.png" alt="Arte do evento"></p><h2>Evento externo</h2><p>Evento sem imagem oficial.<img src="https://evil.example/image.png"></p></div></section></body></html>`;
  const article = parseRiotArticle(html, url);
  const classified = classifyRiotArticle(article);
  const event = classified.updates.find((item) => item.name === 'Festival de Batalhas');
  const untrusted = classified.updates.find((item) => item.name === 'Evento externo');
  assert.equal(event.image, 'https://cmsassets.rgpub.io/event.png');
  assert.equal(untrusted.image, null);
});
