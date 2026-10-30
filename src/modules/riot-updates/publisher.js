import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  WebhookClient,
} from 'discord.js';
import { updateRiotSetting, getRiotSettings } from './settings.js';
import { buildPublicationMessages, buildWebhookPayload, containsPublicationMarker } from './format.js';
import {
  RIOT_PUBLICATION_COLLECTION,
  RIOT_PUBLICATION_ITEM_COLLECTION,
  RIOT_SCHEDULER_STATE_COLLECTION,
  claimPublication,
  getDuePublicationQueue,
  getLatestFailedPublication,
  getNextQueuedPublication,
  getPublication,
  getStaleSendingPublications,
  markArticlePipelineStatus,
  reopenFailedPublication,
  saveRiotError,
  updatePublication,
  updatePublicationItems,
} from './repository.js';

const MAX_PUBLICATION_ATTEMPTS = 5;
const MAX_AUTO_PUBLICATIONS_PER_INSPECTION = 5;
const ALLOWED_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const PIPELINE_LABELS = Object.freeze({ patchNotes: 'Patch Notes', updates: 'Updates' });

function logger(context, event, fields = {}) {
  const record = { level: 'info', event, at: new Date().toISOString(), ...fields };
  if (typeof context.logger === 'function') context.logger(record);
  else console.info(JSON.stringify(record));
}

function pipelineSettings(settings, pipeline) {
  if (!['patchNotes', 'updates'].includes(pipeline)) throw new Error('RIOT_PIPELINE_INVALID');
  return settings[pipeline];
}

async function getGuildChannel(context, channelId) {
  const channel = await context.client.channels.fetch(channelId);
  if (!channel || !ALLOWED_CHANNEL_TYPES.has(channel.type) || channel.guildId !== context.guildId) {
    throw new Error('RIOT_DESTINATION_CHANNEL_INVALID');
  }
  return channel;
}

export function missingRiotChannelPermissions(permissions, { creatingWebhook = false } = {}) {
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  if (creatingWebhook) required.push(PermissionFlagsBits.ManageWebhooks);
  return required.filter((permission) => !permissions?.has?.(permission));
}

async function verifyChannelPermissions(context, channel, options = {}) {
  const guild = context.client.guilds.cache.get(context.guildId)
    ?? await context.client.guilds.fetch(context.guildId);
  const member = guild.members.me ?? await guild.members.fetchMe();
  const permissions = channel.permissionsFor(member);
  const missing = missingRiotChannelPermissions(permissions, options);
  if (missing.length) {
    throw new Error(options.creatingWebhook ? 'RIOT_WEBHOOK_PERMISSIONS_MISSING' : 'RIOT_PUBLISH_PERMISSIONS_MISSING');
  }
}

export async function validateRiotPipelineForActivation(context, pipeline, options = {}) {
  const settings = await getRiotSettings(context.database);
  const stream = pipelineSettings(settings, pipeline);
  const selectedRoleId = Object.hasOwn(options, 'roleId') ? options.roleId : stream.roleId;
  if (!stream.channelId || !stream.webhook?.id) throw new Error('RIOT_DESTINATION_NOT_CONFIGURED');
  if (!stream.webhook.token) throw new Error('RIOT_WEBHOOK_TOKEN_UNAVAILABLE');
  const channel = await getGuildChannel(context, stream.channelId);
  await verifyChannelPermissions(context, channel);
  if (stream.webhook.channelId && stream.webhook.channelId !== channel.id) {
    throw new Error('RIOT_WEBHOOK_CHANNEL_MISMATCH');
  }
  const webhook = await context.client.fetchWebhook(stream.webhook.id, stream.webhook.token);
  if (webhook.channelId !== channel.id) throw new Error('RIOT_WEBHOOK_CHANNEL_MISMATCH');
  if (selectedRoleId) {
    if (String(selectedRoleId) === String(context.guildId)) throw new Error('RIOT_ROLE_NOT_ALLOWED');
    const guild = context.client.guilds.cache.get(context.guildId)
      ?? await context.client.guilds.fetch(context.guildId);
    const role = guild.roles.cache.get(selectedRoleId) ?? await guild.roles.fetch(selectedRoleId);
    if (!role) throw new Error('RIOT_ROLE_NOT_FOUND');
    const member = guild.members.me ?? await guild.members.fetchMe();
    const permissions = channel.permissionsFor(member);
    if (role && !role.mentionable && !permissions?.has?.(PermissionFlagsBits.MentionEveryone)) {
      throw new Error('RIOT_ROLE_MENTION_PERMISSION_MISSING');
    }
  }
  return { channelId: channel.id, webhookId: webhook.id };
}

export async function createRiotWebhook(context, pipeline) {
  const settings = await getRiotSettings(context.database);
  const current = pipelineSettings(settings, pipeline);
  if (current.webhook?.id) throw new Error('RIOT_WEBHOOK_ALREADY_CONFIGURED');
  if (!current.channelId) throw new Error('RIOT_DESTINATION_CHANNEL_REQUIRED');

  const channel = await getGuildChannel(context, current.channelId);
  await verifyChannelPermissions(context, channel, { creatingWebhook: true });
  const available = await channel.fetchWebhooks();
  const name = PIPELINE_LABELS[pipeline];
  if (available.some((webhook) => webhook.name === name && webhook.owner?.id === context.client.user.id)) {
    throw new Error('RIOT_WEBHOOK_NAME_ALREADY_EXISTS');
  }

  const webhook = await channel.createWebhook({ name });
  if (!webhook.token) {
    await webhook.delete('Token de webhook não retornado para armazenamento seguro').catch(() => {});
    throw new Error('RIOT_WEBHOOK_TOKEN_MISSING');
  }
  try {
    await updateRiotSetting(context.database, `${pipeline}.webhook`, {
      id: webhook.id,
      channelId: channel.id,
      name,
      token: webhook.token,
      createdAt: new Date(),
    });
  } catch (error) {
    await webhook.delete('Não foi possível salvar a configuração do webhook').catch(() => {});
    throw error;
  }

  logger(context, 'riot_webhook_created', { pipeline, channelId: channel.id, webhookId: webhook.id });
  return { id: webhook.id, channelId: channel.id, name };
}

export async function deleteRiotWebhook(context, pipeline) {
  const settings = await getRiotSettings(context.database);
  const current = pipelineSettings(settings, pipeline);
  const webhook = current.webhook;
  if (!webhook?.id) return false;

  try {
    const channel = await getGuildChannel(context, webhook.channelId ?? current.channelId);
    const hooks = await channel.fetchWebhooks();
    const managedHook = hooks.get(webhook.id);
    if (managedHook) await managedHook.delete('Webhook Riot removido pelo painel administrativo');
  } catch (error) {
    if (error?.status !== 404 && error?.code !== 10015 && error?.code !== 10003) throw error;
  }
  await updateRiotSetting(context.database, `${pipeline}.enabled`, false);
  await updateRiotSetting(context.database, `${pipeline}.webhook`, null);
  const remainingSettings = await getRiotSettings(context.database);
  if (!remainingSettings.patchNotes.enabled && !remainingSettings.updates.enabled) {
    await updateRiotSetting(context.database, 'scheduler.enabled', false);
  }
  logger(context, 'riot_webhook_deleted', { pipeline, webhookId: webhook.id });
  return true;
}

function getWebhookClient(stream) {
  if (!stream.webhook?.id || !stream.webhook?.token) throw new Error('RIOT_WEBHOOK_NOT_CONFIGURED');
  return new WebhookClient({ id: stream.webhook.id, token: stream.webhook.token });
}

export function sanitizeRiotWebhookError(error, stream) {
  let message = String(error?.message ?? 'Falha ao publicar conteúdo Riot');
  const token = stream?.webhook?.token;
  if (typeof token === 'string' && token) message = message.split(token).join('[credencial removida]');
  return message
    .replace(/(https?:\/\/(?:canary\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/)[^\s/?]+/giu, '$1[credencial removida]')
    .replace(/(webhook(?:\s+)?(?:token|secret)\s*[:=]\s*)[^\s,;]+/giu, '$1[credencial removida]')
    .slice(0, 500);
}

function messageComponentsHaveMarker(message, marker) {
  return containsPublicationMarker(message, marker);
}

async function recentWebhookMessages(channel, webhookId) {
  const messages = await channel.messages.fetch({ limit: 100 });
  return [...messages.values()].filter((message) => message.webhookId === webhookId);
}

async function reconcilePublication(context, publication, stream) {
  const channel = await getGuildChannel(context, stream.channelId);
  await verifyChannelPermissions(context, channel);
  const messages = await recentWebhookMessages(channel, stream.webhook.id);
  const found = [...(publication.messages ?? [])];
  const foundMarkers = new Set(found.map((item) => item.marker));
  for (const marker of publication.markers ?? []) {
    if (foundMarkers.has(marker)) continue;
    const message = messages.find((candidate) => messageComponentsHaveMarker(candidate, marker));
    if (message) {
      found.push({ marker, id: message.id, recoveredAt: new Date() });
      foundMarkers.add(marker);
    }
  }
  await updatePublication(context.database, publication._id, {
    messages: found,
    messageIds: found.map((item) => item.id).filter(Boolean),
  });
  return found;
}

function retryDate(attempts, now = new Date(), random = Math.random) {
  const exponential = Math.min(6 * 60 * 60_000, 5 * 60_000 * (2 ** Math.max(0, attempts - 1)));
  return new Date(now.getTime() + Math.round(exponential * (0.75 + random() * 0.5)));
}

async function markPublicationComplete(context, publication, messages, now = new Date()) {
  const messageIds = messages.map((item) => item.id).filter(Boolean);
  await updatePublication(context.database, publication._id, {
    status: 'PUBLISHED',
    messages,
    messageIds,
    publishedAt: now,
    nextAttemptAt: null,
    failure: null,
  });
  await updatePublicationItems(context.database, publication._id, 'PUBLISHED', { publishedAt: now, messageIds });
  await markArticlePipelineStatus(
    context.database,
    publication.articleUrl,
    publication.pipeline,
    'PUBLISHED',
    { lastPublishedAt: now, lastPublishedMessageIds: messageIds },
  );
  await context.database.collection(RIOT_SCHEDULER_STATE_COLLECTION).updateOne(
    { _id: 'riot-global' },
    { $set: { lastPublicationAt: now, lastPublicationId: publication._id, lastPublicationPipeline: publication.pipeline } },
  );
  logger(context, 'riot_publication_sent', {
    pipeline: publication.pipeline,
    articleUrl: publication.articleUrl,
    publicationId: publication._id,
    messages: messageIds.length,
  });
  return { status: 'PUBLISHED', messageIds };
}

async function failPublication(context, publication, error, attempts, stream) {
  const permanentlyFailed = attempts >= MAX_PUBLICATION_ATTEMPTS;
  const status = permanentlyFailed ? 'FAILED' : 'RETRYABLE_FAILURE';
  const nextAttemptAt = permanentlyFailed ? null : retryDate(attempts);
  const code = String(error?.code ?? error?.name ?? 'RIOT_PUBLICATION_ERROR').slice(0, 80);
  const publicMessage = sanitizeRiotWebhookError(error, stream);
  await updatePublication(context.database, publication._id, {
    status,
    failure: { code, message: publicMessage, at: new Date() },
    nextAttemptAt,
    sendingAt: null,
  });
  await updatePublicationItems(context.database, publication._id, status, { nextAttemptAt });
  await saveRiotError(context.database, {
    scope: `publication:${publication.pipeline}`,
    code,
    message: publicMessage,
    details: { articleUrl: publication.articleUrl, publicationId: publication._id },
  });
  logger(context, 'riot_publication_failed', {
    pipeline: publication.pipeline,
    publicationId: publication._id,
    code,
    retryAt: nextAttemptAt?.toISOString() ?? null,
    attempts,
  });
  return { status, error: code, nextAttemptAt };
}

export async function publishRiotPublication(context, publicationId, { requireEnabled = true } = {}) {
  const publication = await getPublication(context.database, publicationId);
  if (!publication || !['QUEUED', 'RETRYABLE_FAILURE'].includes(publication.status)) {
    return { status: publication?.status ?? 'NOT_FOUND' };
  }
  const settings = await getRiotSettings(context.database);
  const stream = pipelineSettings(settings, publication.pipeline);
  if (requireEnabled && !stream.enabled) return { status: 'DISABLED' };
  if (publication.nextAttemptAt && new Date(publication.nextAttemptAt) > new Date()) {
    return { status: 'RETRY_WAIT', nextAttemptAt: publication.nextAttemptAt };
  }

  const claimed = await claimPublication(context.database, publication._id);
  if (!claimed) return { status: 'ALREADY_CLAIMED' };
  const attempts = (publication.attempts ?? 0) + 1;
  await updatePublicationItems(context.database, publication._id, 'SENDING', { sendingAt: new Date() });

  try {
    if (!stream.channelId || !stream.webhook?.id) throw new Error('RIOT_DESTINATION_NOT_CONFIGURED');
    if (stream.roleId && String(stream.roleId) === String(context.guildId)) throw new Error('RIOT_ROLE_NOT_ALLOWED');
    const channel = await getGuildChannel(context, stream.channelId);
    await verifyChannelPermissions(context, channel);
    const webhookClient = getWebhookClient(stream);
    const messages = buildPublicationMessages(
      publication.article,
      publication.pipeline,
      publication.items ?? [],
      publication._id,
    );
    const markers = messages.map((message) => message.marker);
    await updatePublication(context.database, publication._id, { markers });

    let sentMessages = publication.markers?.length || publication.messages?.length
      ? await reconcilePublication(context, { ...publication, markers }, stream)
      : [];
    const existingMarkers = new Set(sentMessages.map((item) => item.marker));
    if (markers.every((marker) => existingMarkers.has(marker))) {
      return markPublicationComplete(context, publication, sentMessages);
    }

    for (const page of messages) {
      if (existingMarkers.has(page.marker)) continue;
      const payload = buildWebhookPayload(page, page.page === 1 ? stream.roleId : null);
      const message = typeof context.riotWebhookSend === 'function'
        ? await context.riotWebhookSend({ pipeline: publication.pipeline, webhookId: stream.webhook.id, payload })
        : await webhookClient.send(payload);
      const record = { marker: page.marker, id: message?.id ?? null, page: page.page, sentAt: new Date() };
      sentMessages = [...sentMessages, record];
      existingMarkers.add(page.marker);
      await updatePublication(context.database, publication._id, {
        messages: sentMessages,
        messageIds: sentMessages.map((item) => item.id).filter(Boolean),
        markers,
      });
    }
    return markPublicationComplete(context, publication, sentMessages);
  } catch (error) {
    if (error?.message === 'RIOT_PUBLICATION_CONTAINER_TOO_LONG' || error?.message === 'RIOT_PUBLICATION_COMPONENT_LIMIT') {
      await updatePublication(context.database, publication._id, {
        status: 'REVIEW_REQUIRED',
        failure: { code: error.message, message: 'Conteúdo ultrapassa o limite seguro de formatação.', at: new Date() },
        sendingAt: null,
      });
      await updatePublicationItems(context.database, publication._id, 'REVIEW_REQUIRED');
      await saveRiotError(context.database, {
        scope: `publication:${publication.pipeline}`,
        code: error.message,
        message: 'Conteúdo preservado para revisão porque não cabe nos limites de Components V2.',
        details: { articleUrl: publication.articleUrl, publicationId: publication._id },
      });
      return { status: 'REVIEW_REQUIRED', error: error.message };
    }
    return failPublication(context, publication, error, attempts, stream);
  }
}

export async function publishQueuedRiotUpdates(context, { limit = MAX_AUTO_PUBLICATIONS_PER_INSPECTION } = {}) {
  await reconcileStaleRiotPublications(context);
  const settings = await getRiotSettings(context.database);
  const queued = await getDuePublicationQueue(context.database, new Date(), Math.min(limit, 25));
  const results = [];
  for (const publication of queued) {
    if (!settings[publication.pipeline]?.enabled) continue;
    results.push(await publishRiotPublication(context, publication._id));
  }
  return results;
}

export async function reconcileStaleRiotPublications(context, now = new Date()) {
  const stale = await getStaleSendingPublications(context.database, new Date(now.getTime() - 5 * 60_000));
  const results = [];
  for (const publication of stale) {
    let stream = null;
    try {
      const settings = await getRiotSettings(context.database);
      stream = pipelineSettings(settings, publication.pipeline);
      if (!stream.enabled || !stream.webhook?.id || !stream.channelId) continue;
      const messages = await reconcilePublication(context, publication, stream);
      const markers = publication.markers ?? [];
      const foundMarkers = new Set(messages.map((message) => message.marker));
      if (markers.length && markers.every((marker) => foundMarkers.has(marker))) {
        results.push(await markPublicationComplete(context, publication, messages, now));
      } else {
        const attempts = publication.attempts ?? 1;
        await updatePublication(context.database, publication._id, {
          status: attempts >= MAX_PUBLICATION_ATTEMPTS ? 'FAILED' : 'RETRYABLE_FAILURE',
          nextAttemptAt: attempts >= MAX_PUBLICATION_ATTEMPTS ? null : retryDate(attempts, now),
          sendingAt: null,
          messages,
          messageIds: messages.map((item) => item.id).filter(Boolean),
        });
        await updatePublicationItems(context.database, publication._id, 'RETRYABLE_FAILURE');
        results.push({ status: 'RETRYABLE_FAILURE', publicationId: publication._id });
      }
    } catch (error) {
      await saveRiotError(context.database, {
        scope: `reconciliation:${publication.pipeline}`,
        code: error?.code ?? error?.name,
        message: sanitizeRiotWebhookError(error, stream),
        details: { publicationId: publication._id, articleUrl: publication.articleUrl },
      });
      results.push({ status: 'RECOVERY_FAILED', publicationId: publication._id });
    }
  }
  return results;
}

export async function getQueuedRiotPublication(database, pipeline) {
  return getNextQueuedPublication(database, pipeline);
}

export async function getRiotPublicationForPreview(database, id, pipeline) {
  const publication = await getPublication(database, id);
  if (
    !publication
    || publication.pipeline !== pipeline
    || !['QUEUED', 'RETRYABLE_FAILURE'].includes(publication.status)
  ) return null;
  return publication;
}

export async function retryFailedRiotPublication(context, pipeline) {
  const settings = await getRiotSettings(context.database);
  const stream = pipelineSettings(settings, pipeline);
  if (!stream.enabled) return { status: 'DISABLED' };
  await validateRiotPipelineForActivation(context, pipeline);
  const failed = await getLatestFailedPublication(context.database, pipeline);
  if (!failed) return { status: 'NOT_FOUND' };
  const reopened = await reopenFailedPublication(context.database, failed._id);
  if (reopened.status === 'QUEUED') {
    await markArticlePipelineStatus(context.database, failed.articleUrl, pipeline, 'QUEUED', {
      manualRetryCount: reopened.publication.manualRetries,
    });
    return { status: 'QUEUED', publicationId: failed._id, manualRetries: reopened.publication.manualRetries };
  }
  return reopened;
}

export function serializeRiotPublicationSummary(publication) {
  if (!publication) return null;
  return {
    id: publication._id,
    pipeline: publication.pipeline,
    articleUrl: publication.articleUrl,
    title: publication.article?.title ?? 'Conteúdo oficial',
    version: publication.article?.version ?? null,
    itemCount: publication.items?.length ?? 0,
    status: publication.status,
    createdAt: publication.createdAt,
  };
}

export function buildRiotPreviewPayload(publication, pageNumber = 1) {
  const messages = buildPublicationMessages(
    publication.article,
    publication.pipeline,
    publication.items ?? [],
    publication._id,
  );
  const requestedPage = Number(pageNumber);
  const pageIndex = Number.isFinite(requestedPage)
    ? Math.max(0, Math.min(messages.length - 1, Math.floor(requestedPage - 1)))
    : 0;
  const page = messages[pageIndex];
  return {
    ...page,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [], roles: [], users: [] },
    omittedItems: Math.max(0, (publication.items?.length ?? 0) - (page.itemsInPage ?? 0)),
    pageIndex: pageIndex + 1,
  };
}

export const RIOT_PUBLICATION_COLLECTION_NAME = RIOT_PUBLICATION_COLLECTION;
export const RIOT_PUBLICATION_ITEM_COLLECTION_NAME = RIOT_PUBLICATION_ITEM_COLLECTION;
