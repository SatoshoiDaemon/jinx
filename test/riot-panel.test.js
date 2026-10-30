import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RIOT_UPDATES_SETTINGS } from '../src/config/defaults.js';
import { buildPanelRows, renderPanelContent } from '../src/modules/panel/components.js';
import { createV2Container } from '../src/modules/common/components-v2.js';
import { normalizeRiotSettings } from '../src/modules/riot-updates/settings.js';
import { handleRiotPanelInteraction } from '../src/modules/riot-updates/panel.js';
import { MemoryDatabase } from '../test-support/memory-mongo.js';

test('renderiza projeção oficial no painel e limita controles às linhas do Discord', () => {
  const settings = normalizeRiotSettings(DEFAULT_RIOT_UPDATES_SETTINGS);
  const content = renderPanelContent(
    'riot_updates',
    null,
    { channels: { cache: new Map() }, roles: { cache: new Map() } },
    'overview',
    undefined,
    'levels',
    'overview',
    settings,
    'scheduler',
    {
      monitorWindows: {
        minor: {
          expectedAt: new Date('2026-11-04T09:00:00Z'),
          startsAt: new Date('2026-11-03T15:00:00Z'),
          endsAt: new Date('2026-11-05T03:00:00Z'),
          cadenceDays: 7,
          basedOnVersion: '7.3d',
        },
        major: null,
      },
    },
  );
  assert.match(content, /04\/11\/2026, 09:00 UTC/u);
  assert.match(content, /mediana de 7 dias desde 7\.3d/u);
  assert.match(content, /agenda fica desligada/u);

  const container = createV2Container(content);
  assert.equal(container.toJSON().type, 17);
  assert.ok(container.toJSON().components.every((component) => component.type === 10));

  const settingsRows = buildPanelRows('riot_updates', 'overview', undefined, 'levels', 'overview', undefined, settings, 'patchNotes');
  const scheduleRows = buildPanelRows('riot_updates', 'overview', undefined, 'levels', 'overview', undefined, settings, 'scheduler');
  const statusRows = buildPanelRows('riot_updates', 'overview', undefined, 'levels', 'overview', undefined, settings, 'status');
  for (const rows of [settingsRows, scheduleRows, statusRows]) {
    assert.ok(rows.length <= 5);
    assert.ok(rows.every((row) => row.toJSON().type === 1));
    assert.ok(rows.every((row) => row.toJSON().components.length <= 5));
  }
  const scheduleIds = scheduleRows.flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.ok(scheduleIds.includes('panel:riot:scheduler:toggle'));
  assert.ok(scheduleIds.includes('panel:riot:policy'));
  assert.ok(scheduleIds.includes('panel:riot:language'));
  const statusIds = statusRows.flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
  assert.ok(statusIds.includes('panel:riot:retry-failed:patchNotes'));
  assert.ok(statusIds.includes('panel:riot:retry-failed:updates'));
});

test('permite navegar por todas as páginas da prévia antes da aprovação', async () => {
  const database = new MemoryDatabase();
  const publicationId = 'abcdef1234567890abcdef12';
  await database.collection('riot_publications').insertOne({
    _id: publicationId,
    pipeline: 'updates',
    status: 'QUEUED',
    article: {
      title: 'Atualização 7.3',
      version: '7.3',
      canonicalUrl: 'https://wildrift.leagueoflegends.com/pt-br/news/game-updates/patch-7-3/',
    },
    items: Array.from({ length: 20 }, (_, index) => ({
      category: 'EVENT',
      categories: ['EVENT'],
      name: `Evento ${index + 1}`,
      description: `Descrição oficial ${index + 1}.`,
      originalText: `Descrição oficial ${index + 1}.`,
    })),
  });

  let response;
  const interaction = {
    customId: `panel:riot:preview-page:updates:${publicationId}:2`,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isButton: () => true,
    update: async (payload) => { response = payload; },
  };

  assert.equal(await handleRiotPanelInteraction(interaction, { database }), true);
  const serialized = response.components[0].toJSON();
  assert.ok(serialized.components.some((component) => component.content?.includes('Prévia 2/3')));
  const actionRow = serialized.components.find((component) => component.type === 1);
  assert.deepEqual(actionRow.components.map((component) => component.label), ['Anterior', 'Próxima', 'Aprovar publicação']);
  assert.ok(actionRow.components[0].custom_id.endsWith(':1'));
  assert.ok(actionRow.components[1].custom_id.endsWith(':3'));
  assert.ok(actionRow.components[2].custom_id === `panel:riot:publish:${publicationId}`);
  assert.deepEqual(response.allowedMentions, { parse: [], roles: [], users: [] });
});
