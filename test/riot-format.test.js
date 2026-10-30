import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import {
  MAX_PUBLICATION_COMPONENTS_PER_MESSAGE,
  MAX_TOP_LEVEL_COMPONENTS_PER_MESSAGE,
  buildPublicationMessages,
  buildWebhookPayload,
  isComponentsV2Message,
} from '../src/modules/riot-updates/format.js';

function countComponents(component) {
  const data = typeof component.toJSON === 'function' ? component.toJSON() : component;
  let count = Number.isInteger(data?.type) ? 1 : 0;
  for (const key of ['components', 'items']) {
    if (Array.isArray(data?.[key])) count += data[key].reduce((sum, child) => sum + countComponents(child), 0);
  }
  return count;
}

function sampleItem(index) {
  return {
    category: index % 2 ? 'CHAMPION_BALANCE' : 'EVENT',
    categories: index % 2 ? ['CHAMPION_BALANCE'] : ['EVENT', 'SKIN_RELEASE'],
    availability: index % 2 ? null : 'LANÇAMENTO ANUNCIADO',
    name: `Item ${index}`,
    description: `Descrição oficial ${index}. ` + 'Texto de alteração. '.repeat(index % 3 ? 50 : 450),
    originalText: `Descrição oficial ${index}`,
    image: 'https://cmsassets.rgpub.io/some-official-image.png',
    skills: [],
    values: [],
  };
}

test('serializa Containers V2, limita menções e mantém um container por item', () => {
  const article = {
    title: '@everyone Atualização 7.3',
    version: '7.3',
    publishedAt: new Date('2026-09-21T09:00:00.000Z'),
    summary: 'Resumo da Riot com @here literal.',
    canonicalUrl: 'https://wildrift.leagueoflegends.com/pt-br/news/game-updates/patch-notes-7-3/',
    heroImage: 'https://cmsassets.rgpub.io/hero.png',
  };
  const items = Array.from({ length: 18 }, (_, index) => sampleItem(index));
  const pages = buildPublicationMessages(article, 'updates', items, 'abcdef1234567890');
  assert.ok(pages.length > 1);
  assert.equal(pages.reduce((total, page) => total + page.itemsInPage, 0), items.length);

  for (const page of pages) {
    assert.ok(isComponentsV2Message(page));
    assert.equal(page.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
    assert.ok(page.components.length <= MAX_TOP_LEVEL_COMPONENTS_PER_MESSAGE);
    assert.ok(page.components.every((component) => component.toJSON().type === 17));
    assert.ok(page.components.reduce((total, component) => total + countComponents(component), 0) <= MAX_PUBLICATION_COMPONENTS_PER_MESSAGE);
    assert.equal(page.components.length, page.itemsInPage + 1);
  }
  assert.deepEqual(pages.map((page) => page.page), pages.map((_, index) => index + 1));

  const payload = buildWebhookPayload(pages[0], '123456789012345678');
  assert.deepEqual(payload.allowedMentions, { parse: [], roles: ['123456789012345678'], users: [] });
  assert.ok(JSON.stringify(payload.components[0].toJSON()).includes('<@&123456789012345678>'));
  assert.ok(!JSON.stringify(pages[0].components[0].toJSON()).includes('<@&123456789012345678>'));
  const unpinged = buildWebhookPayload(pages[1]);
  assert.deepEqual(unpinged.allowedMentions, { parse: [], roles: [], users: [] });
});

test('divide conteúdos longos apenas entre containers e preserva ordem e integridade', () => {
  const article = {
    title: 'Patch 7.3b',
    canonicalUrl: 'https://wildrift.leagueoflegends.com/pt-br/news/game-updates/patch-notes-7-3b/',
  };
  const items = Array.from({ length: 24 }, (_, index) => sampleItem(index));
  const pages = buildPublicationMessages(article, 'patchNotes', items, '0123456789abcdef');
  const renderedNames = pages.flatMap((page) => page.components.slice(1).flatMap((container) => (
    container.toJSON().components.map((component) => component.content ?? '')
  ))).join('\n');
  for (const item of items) assert.ok(renderedNames.includes(`## ${item.name}`));
  assert.equal(pages.reduce((total, page) => total + page.itemsInPage, 0), 24);
});

test('mostra valores de habilidades e atributos sem normalizar os números', () => {
  const article = {
    title: 'Patch 7.3b',
    canonicalUrl: 'https://wildrift.leagueoflegends.com/pt-br/news/game-updates/patch-notes-7-3b/',
  };
  const item = {
    category: 'CHAMPION_BALANCE',
    name: 'Volibear',
    description: 'Resumo oficial.',
    originalText: 'Vida base: 690 → 660\nMultiplicador: 100% → 110%',
    values: [
      { raw: 'Vida base: 690 → 660' },
      { raw: 'Multiplicador: 100% → 110%' },
    ],
    skills: [{
      name: 'Fúria Selvagem',
      description: 'Dano ajustado.',
      values: [{ raw: 'Multiplicador: 100% → 110%' }],
    }],
  };
  const page = buildPublicationMessages(article, 'patchNotes', [item], 'abcdef1234567890')[0];
  const content = JSON.stringify(page.components.map((component) => component.toJSON()));
  assert.ok(content.includes('Vida base: 690 → 660'));
  assert.ok(content.includes('Multiplicador: 100% → 110%'));
  assert.equal(content.split('Multiplicador: 100% → 110%').length - 1, 1);
});

test('encaminha uma descrição que não cabe em um container para revisão', () => {
  const article = { title: 'Patch 7.3', canonicalUrl: 'https://wildrift.leagueoflegends.com/pt-br/news/game-updates/patch-7-3/' };
  assert.throws(() => buildPublicationMessages(article, 'patchNotes', [{
    category: 'CHAMPION_BALANCE', name: 'Campeão', description: 'x'.repeat(3_800 * 9),
  }], 'abcdef1234567890'), /RIOT_PUBLICATION_CONTAINER_TOO_LONG/u);
});
