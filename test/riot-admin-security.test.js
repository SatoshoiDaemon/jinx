import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { createRiotWebhook, missingRiotChannelPermissions, sanitizeRiotWebhookError } from '../src/modules/riot-updates/publisher.js';
import { handlePanelInteraction } from '../src/modules/panel/service.js';
import { getRiotSettings, normalizeRiotSettings, updateRiotSetting } from '../src/modules/riot-updates/settings.js';
import { handleRiotPanelInteraction } from '../src/modules/riot-updates/panel.js';
import { MemoryDatabase } from '../test-support/memory-mongo.js';

test('exige permissão administrativa para alterar configurações Riot em /painel', async () => {
  let reply;
  const interaction = {
    customId: 'panel:riot:toggle:patchNotes',
    memberPermissions: { has: () => false },
    isButton: () => true,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    reply: async (payload) => { reply = payload; },
  };
  assert.equal(await handlePanelInteraction(interaction, {}), true);
  assert.ok(reply.components?.length);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('valida permissões do bot para criação e publicação de webhook', () => {
  const granted = new Set([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ]);
  const permissions = { has: (permission) => granted.has(permission) };
  assert.deepEqual(missingRiotChannelPermissions(permissions), []);
  assert.deepEqual(missingRiotChannelPermissions(permissions, { creatingWebhook: true }), [PermissionFlagsBits.ManageWebhooks]);
  assert.equal(missingRiotChannelPermissions({ has: () => false }).length, 3);
});

test('salva o token do webhook diretamente no Mongo sem exigir chave adicional', async () => {
  const database = new MemoryDatabase();
  const guildId = '123456789012345678';
  const channelId = '223456789012345678';
  const webhookId = '323456789012345678';
  const webhookToken = 'token-plano-do-webhook';
  const granted = new Set([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageWebhooks,
  ]);
  let webhookOptions;
  const channel = {
    id: channelId,
    guildId,
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: (permission) => granted.has(permission) }),
    fetchWebhooks: async () => [],
    createWebhook: async (options) => {
      webhookOptions = options;
      return { id: webhookId, token: webhookToken };
    },
  };
  const context = {
    database,
    guildId,
    logger: () => {},
    client: {
      user: { id: '423456789012345678' },
      channels: { fetch: async () => channel },
      guilds: { cache: new Map([[guildId, { members: { me: { id: '423456789012345678' } } }]]) },
    },
  };

  await updateRiotSetting(database, 'patchNotes.channelId', channelId);
  const created = await createRiotWebhook(context, 'patchNotes');
  const settings = await getRiotSettings(database);

  assert.deepEqual(webhookOptions, { name: 'Patch Notes' });
  assert.equal(created.id, webhookId);
  assert.equal(settings.patchNotes.webhook.token, webhookToken);
  assert.equal(settings.patchNotes.webhook.encryptedToken, undefined);
});

test('bloqueia a seleção do cargo @everyone para notificações', async () => {
  const guildId = '123456789012345678';
  let reply;
  const interaction = {
    customId: 'panel:riot:role:updates',
    values: [guildId],
    guild: { id: guildId, roles: { cache: new Map([[guildId, { id: guildId, name: '@everyone' }]]) } },
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => true,
    isButton: () => false,
    reply: async (payload) => { reply = payload; },
  };
  assert.equal(await handleRiotPanelInteraction(interaction, {}), true);
  assert.ok(JSON.stringify(reply.components).includes('cargo @everyone'));
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('remove tokens de webhook de mensagens de erro persistidas', () => {
  const token = 'very-secret-webhook-token';
  const stream = { webhook: { token } };
  const error = new Error(`POST https://discord.com/api/v10/webhooks/123456789012345678/${token} falhou`);
  const message = sanitizeRiotWebhookError(error, stream);
  assert.ok(!message.includes(token));
  assert.ok(message.includes('[credencial removida]'));
  assert.ok(message.length <= 500);
});

test('defaults Riot mantêm português prioritário e todos os fluxos desativados', () => {
  const settings = normalizeRiotSettings({ preferredLanguage: 'invalid', fallbackEnglish: true });
  assert.equal(settings.preferredLanguage, 'pt-br');
  assert.equal(settings.fallbackEnglish, true);
  assert.equal(settings.patchNotes.enabled, false);
  assert.equal(settings.updates.enabled, false);
  assert.equal(settings.scheduler.enabled, false);
  assert.equal(settings.firstActivationPolicy, 'register_only');
});

test('persiste as janelas adaptativas e rejeita paths administrativos não permitidos', async () => {
  const database = new MemoryDatabase();
  await updateRiotSetting(database, 'scheduler.minorWindow.enabled', false);
  await updateRiotSetting(database, 'scheduler.majorWindow.durationHours', 48);
  const settings = await getRiotSettings(database);
  assert.equal(settings.scheduler.minorWindow.enabled, false);
  assert.equal(settings.scheduler.majorWindow.durationHours, 48);
  await assert.rejects(updateRiotSetting(database, 'scheduler.webhookToken', 'secret'), /RIOT_SETTING_PATH_INVALID/u);
});
