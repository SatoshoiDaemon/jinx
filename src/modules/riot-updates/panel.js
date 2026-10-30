import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';
import { replyV2, v2EditPayload } from '../common/components-v2.js';
import { buildPanelRows, buildRiotScheduleModal, renderPanelContent } from '../panel/components.js';
import { getRiotSettings, updateRiotSetting, validateRiotWindow } from './settings.js';
import {
  buildRiotPreviewPayload,
  createRiotWebhook,
  deleteRiotWebhook,
  getQueuedRiotPublication,
  getRiotPublicationForPreview,
  publishRiotPublication,
  retryFailedRiotPublication,
  validateRiotPipelineForActivation,
} from './publisher.js';
import { getRiotSourceHealth, runRiotManualInspection } from './service.js';

const PIPELINES = new Set(['patchNotes', 'updates']);
const RIOT_PAGES = new Set(['patchNotes', 'updates', 'scheduler', 'status']);

const USER_MESSAGES = Object.freeze({
  RIOT_DESTINATION_CHANNEL_REQUIRED: 'Escolha o canal de destino antes de ativar este fluxo.',
  RIOT_DESTINATION_NOT_CONFIGURED: 'Configure o canal, crie o webhook e valide as permissões antes de ativar.',
  RIOT_DESTINATION_CHANNEL_INVALID: 'O canal precisa ser um canal de texto desta guilda.',
  RIOT_WEBHOOK_NOT_CONFIGURED: 'Crie o webhook deste fluxo pelo painel.',
  RIOT_WEBHOOK_ALREADY_CONFIGURED: 'Este fluxo já tem um webhook configurado. Exclua-o antes de criar outro.',
  RIOT_WEBHOOK_TOKEN_UNAVAILABLE: 'Este webhook veio de uma configuração antiga. Exclua-o e crie outro pelo painel.',
  RIOT_WEBHOOK_NAME_ALREADY_EXISTS: 'Já existe um webhook com esse nome no canal. Remova-o no Discord antes de criar o webhook gerenciado.',
  RIOT_WEBHOOK_PERMISSIONS_MISSING: 'O bot precisa de Ver canal, Enviar mensagens, Ler histórico e Gerenciar webhooks no canal.',
  RIOT_PUBLISH_PERMISSIONS_MISSING: 'O bot precisa de Ver canal, Enviar mensagens e Ler histórico no canal escolhido.',
  RIOT_WEBHOOK_CHANNEL_MISMATCH: 'O webhook não pertence ao canal configurado. Exclua-o e crie outro no canal correto.',
  RIOT_ROLE_MENTION_PERMISSION_MISSING: 'Para notificar esse cargo, torne-o mencionável ou conceda ao bot a permissão Mencionar @everyone.',
  RIOT_ROLE_NOT_FOUND: 'O cargo escolhido não está mais disponível nesta guilda.',
  RIOT_ROLE_NOT_ALLOWED: 'Escolha um cargo específico; o cargo @everyone não pode receber notificações automáticas.',
  RIOT_MANUAL_RETRY_LIMIT: 'Este artigo já atingiu o limite de reaberturas administrativas.',
  RIOT_STREAM_DISABLED: 'Ative o fluxo e valide seu webhook antes de reabrir a publicação.',
  RIOT_SCHEDULER_REQUIRES_PIPELINE: 'Ative Patch Notes ou Updates e configure o webhook correspondente antes de ligar o monitoramento.',
  INVALID_RIOT_WINDOW: 'Use horários UTC no formato HH:MM e um horário final posterior ao inicial.',
  INVALID_RIOT_DURATION: 'A duração das janelas precisa ser um número inteiro entre 1 e 168 horas.',
  RIOT_PREVIEW_NOT_FOUND: 'Não há conteúdo pendente para prévia neste fluxo. Execute uma inspeção manual primeiro.',
  RIOT_PUBLICATION_CONTAINER_TOO_LONG: 'Esta publicação excede o limite seguro de Components V2 e foi encaminhada para revisão.',
});

function userMessage(error) {
  return USER_MESSAGES[error?.message] ?? 'Não foi possível concluir a ação de Riot Games. Confira as permissões e tente novamente.';
}

async function sendFollowupNotice(interaction, content) {
  await interaction.followUp({
    components: [{
      type: 17,
      components: [{ type: 10, content }],
    }],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [], roles: [], users: [] },
  });
}

export async function showRiotPage(interaction, context, page, alreadyDeferred = false) {
  if (!RIOT_PAGES.has(page)) page = 'patchNotes';
  if (!alreadyDeferred) await interaction.deferUpdate();
  const [settings, status] = await Promise.all([
    getRiotSettings(context.database),
    getRiotSourceHealth(context),
  ]);
  await interaction.editReply(v2EditPayload(
    renderPanelContent('riot_updates', null, interaction.guild, 'overview', undefined, 'levels', 'overview', settings, page, status),
    { rows: buildPanelRows('riot_updates', 'overview', undefined, 'levels', 'overview', undefined, settings, page) },
  ));
}

async function updateAndRender(interaction, context, path, value, page) {
  await interaction.deferUpdate();
  await updateRiotSetting(context.database, path, value);
  await showRiotPage(interaction, context, page, true);
}

async function runManualInspection(interaction, context) {
  await replyV2(interaction, 'Inspeção manual iniciada. Nenhuma mensagem será publicada automaticamente por esta ação.', { ephemeral: true });
  const result = await runRiotManualInspection(context);
  const counts = result.counts;
  const text = result.status === 'BUSY'
    ? 'Já existe uma inspeção em andamento. Consulte o status no painel e tente novamente depois.'
    : result.status === 'FAILED'
      ? `A inspeção falhou (${result.errors?.[0]?.code ?? 'erro'}). Consulte os erros recentes no painel.`
      : !counts
        ? `A inspeção terminou com estado ${result.status}. Consulte o status no painel.`
    : `Inspeção concluída: ${counts.discovered} artigos encontrados, ${counts.classified} artigos processados, ${counts.queued} prévias pendentes e ${counts.reviewRequired} itens para revisão. Abra a seção Inspeções e prévias para conferir.`;
  await interaction.editReply({
    components: [{ type: 17, components: [{ type: 10, content: text }] }],
    allowedMentions: { parse: [], roles: [], users: [] },
  });
}

async function previewPublication(interaction, context, pipeline, publicationId = null, pageNumber = 1, updateExisting = false) {
  if (!PIPELINES.has(pipeline)) {
    await replyV2(interaction, 'Escolha Patch Notes ou Updates para abrir uma prévia.', { ephemeral: true });
    return;
  }
  const publication = publicationId
    ? await getRiotPublicationForPreview(context.database, publicationId, pipeline)
    : await getQueuedRiotPublication(context.database, pipeline);
  if (!publication) {
    if (updateExisting) {
      await interaction.update({
        components: [{ type: 17, components: [{ type: 10, content: USER_MESSAGES.RIOT_PREVIEW_NOT_FOUND }] }],
        allowedMentions: { parse: [], roles: [], users: [] },
      });
    } else {
      await replyV2(interaction, USER_MESSAGES.RIOT_PREVIEW_NOT_FOUND, { ephemeral: true });
    }
    return;
  }

  try {
    const preview = buildRiotPreviewPayload(publication, pageNumber);
    const container = preview.components[0];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `Prévia ${preview.page}/${preview.totalPages}: confira todas as páginas antes de aprovar. O envio terá ${preview.totalPages} mensagem(ns) com ${publication.items.length} itens.`,
    ));
    const pageControls = new ActionRowBuilder();
    if (preview.totalPages > 1) {
      pageControls.addComponents(
        new ButtonBuilder()
          .setCustomId(`panel:riot:preview-page:${pipeline}:${publication._id}:${Math.max(1, preview.page - 1)}`)
          .setLabel('Anterior')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(preview.page <= 1),
        new ButtonBuilder()
          .setCustomId(`panel:riot:preview-page:${pipeline}:${publication._id}:${Math.min(preview.totalPages, preview.page + 1)}`)
          .setLabel('Próxima')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(preview.page >= preview.totalPages),
      );
    }
    pageControls.addComponents(
      new ButtonBuilder()
        .setCustomId(`panel:riot:publish:${publication._id}`)
        .setLabel('Aprovar publicação')
        .setStyle(ButtonStyle.Success),
    );
    container.addActionRowComponents(pageControls);
    const payload = {
      components: preview.components,
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [], roles: [], users: [] },
    };
    if (updateExisting) {
      await interaction.update({ components: payload.components, allowedMentions: payload.allowedMentions });
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    if (updateExisting) {
      await interaction.update({
        components: [{ type: 17, components: [{ type: 10, content: userMessage(error) }] }],
        allowedMentions: { parse: [], roles: [], users: [] },
      });
    } else {
      await replyV2(interaction, userMessage(error), { ephemeral: true });
    }
  }
}

async function confirmPublication(interaction, context, publicationId) {
  if (!/^[a-f\d]{24}$/iu.test(publicationId)) {
    await replyV2(interaction, 'Esta prévia expirou. Execute outra inspeção e abra uma nova prévia.', { ephemeral: true });
    return;
  }
  await replyV2(interaction, 'Publicando o conteúdo aprovado…', { ephemeral: true });
  const result = await publishRiotPublication(context, publicationId);
  const text = result.status === 'PUBLISHED'
    ? `Publicação concluída em ${result.messageIds?.length ?? 0} mensagem(ns).`
    : result.status === 'REVIEW_REQUIRED'
      ? 'A publicação foi preservada para revisão porque não cabe nos limites seguros do Discord.'
      : result.status === 'ALREADY_CLAIMED'
        ? 'Outra inspeção já está processando esta publicação.'
          : result.status === 'RETRY_WAIT'
            ? `A próxima tentativa está prevista para ${new Date(result.nextAttemptAt).toISOString()} UTC.`
        : result.status === 'DISABLED'
          ? 'Ative o fluxo correspondente antes de publicar manualmente.'
          : `A publicação não foi concluída (${result.error ?? result.status}). Consulte os erros recentes no painel.`;
    await interaction.editReply({
    components: [{ type: 17, components: [{ type: 10, content: text }] }],
    allowedMentions: { parse: [], roles: [], users: [] },
  });
}

async function reopenFailedPublication(interaction, context, pipeline) {
  await replyV2(interaction, 'Validando o destino e reabrindo a última falha sem publicar. A publicação ficará pendente de prévia e aprovação.', { ephemeral: true });
  let result;
  try {
    result = await retryFailedRiotPublication(context, pipeline);
  } catch (error) {
    result = { status: 'ERROR', message: userMessage(error) };
  }
  const text = result.status === 'QUEUED'
    ? `Falha reaberta como prévia pendente (tentativa administrativa ${result.manualRetries}/3). Nenhuma mensagem foi enviada. Abra uma prévia e aprove para publicar.`
    : result.status === 'NOT_FOUND'
      ? 'Não há falhas permanentes pendentes neste fluxo.'
      : result.status === 'RETRY_LIMIT'
        ? USER_MESSAGES.RIOT_MANUAL_RETRY_LIMIT
        : result.status === 'DISABLED'
          ? USER_MESSAGES.RIOT_STREAM_DISABLED
          : result.message ?? `Não foi possível reabrir a falha (${result.status}).`;
  await interaction.editReply({
    components: [{ type: 17, components: [{ type: 10, content: text }] }],
    allowedMentions: { parse: [], roles: [], users: [] },
  });
}

async function saveScheduleModal(interaction, context) {
  const settings = await getRiotSettings(context.database);
  const tuesdayEnd = interaction.fields.getTextInputValue('tuesdayEnd').trim();
  const wednesdayEnd = interaction.fields.getTextInputValue('wednesdayEnd').trim();
  const minorHoursText = interaction.fields.getTextInputValue('minorHours').trim();
  const majorHoursText = interaction.fields.getTextInputValue('majorHours').trim();
  const minorHours = Number(minorHoursText);
  const majorHours = Number(majorHoursText);
  if (
    !validateRiotWindow({ start: settings.scheduler.tuesday.start, end: tuesdayEnd })
    || !validateRiotWindow({ start: settings.scheduler.wednesday.start, end: wednesdayEnd })
  ) {
    await replyV2(interaction, USER_MESSAGES.INVALID_RIOT_WINDOW, { ephemeral: true });
    return true;
  }
  if (
    !/^\d+$/u.test(minorHoursText)
    || !/^\d+$/u.test(majorHoursText)
    || !Number.isInteger(minorHours)
    || !Number.isInteger(majorHours)
    || minorHours < 1 || minorHours > 168
    || majorHours < 1 || majorHours > 168
  ) {
    await replyV2(interaction, USER_MESSAGES.INVALID_RIOT_DURATION, { ephemeral: true });
    return true;
  }
  await interaction.deferUpdate();
  await Promise.all([
    updateRiotSetting(context.database, 'scheduler.tuesday.end', tuesdayEnd),
    updateRiotSetting(context.database, 'scheduler.wednesday.end', wednesdayEnd),
    updateRiotSetting(context.database, 'scheduler.minorWindow.durationHours', minorHours),
    updateRiotSetting(context.database, 'scheduler.majorWindow.durationHours', majorHours),
  ]);
  await showRiotPage(interaction, context, 'scheduler', true);
  return true;
}

export async function handleRiotPanelInteraction(interaction, context) {
  if (!interaction.customId?.startsWith('panel:riot:')) return false;

  if (interaction.isModalSubmit() && interaction.customId === 'panel:riot:modal:windows') {
    return saveScheduleModal(interaction, context);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:riot:page') {
    await showRiotPage(interaction, context, interaction.values[0]);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:riot:preview:pipeline') {
    await previewPublication(interaction, context, interaction.values[0]);
    return true;
  }

  const previewPageMatch = interaction.isButton()
    ? /^panel:riot:preview-page:(patchNotes|updates):([a-f\d]{24}):(\d{1,3})$/iu.exec(interaction.customId)
    : null;
  if (previewPageMatch) {
    const [, pipeline, publicationId, pageNumber] = previewPageMatch;
    await previewPublication(interaction, context, pipeline, publicationId, Number(pageNumber), true);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:riot:policy') {
    const value = interaction.values[0];
    if (!['register_only', 'publish_recent'].includes(value)) {
      await replyV2(interaction, 'Escolha um comportamento válido para a primeira ativação.', { ephemeral: true });
      return true;
    }
    await updateAndRender(interaction, context, 'firstActivationPolicy', value, 'scheduler');
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:riot:language') {
    const value = interaction.values[0];
    if (!['pt-br', 'en-us'].includes(value)) {
      await replyV2(interaction, 'Escolha português do Brasil ou inglês.', { ephemeral: true });
      return true;
    }
    await updateAndRender(interaction, context, 'preferredLanguage', value, 'scheduler');
    return true;
  }

  const channelMatch = interaction.isChannelSelectMenu()
    ? /^panel:riot:channel:(patchNotes|updates)$/u.exec(interaction.customId)
    : null;
  if (channelMatch) {
    const [, pipeline] = channelMatch;
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      await replyV2(interaction, 'Escolha um canal de texto desta guilda.', { ephemeral: true });
      return true;
    }
    const settings = await getRiotSettings(context.database);
    if (settings[pipeline].webhook?.id && settings[pipeline].channelId !== channel.id) {
      await replyV2(interaction, 'Exclua o webhook atual antes de mudar o canal de destino.', { ephemeral: true });
      return true;
    }
    await updateAndRender(interaction, context, `${pipeline}.channelId`, channel.id, pipeline);
    return true;
  }

  const roleMatch = interaction.isRoleSelectMenu()
    ? /^panel:riot:role:(patchNotes|updates)$/u.exec(interaction.customId)
    : null;
  if (roleMatch) {
    const [, pipeline] = roleMatch;
    const roleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
      await replyV2(interaction, USER_MESSAGES.RIOT_ROLE_NOT_FOUND, { ephemeral: true });
      return true;
    }
    if (role.id === interaction.guild.id) {
      await replyV2(interaction, USER_MESSAGES.RIOT_ROLE_NOT_ALLOWED, { ephemeral: true });
      return true;
    }
    const settings = await getRiotSettings(context.database);
    if (settings[pipeline].enabled) {
      try {
        await validateRiotPipelineForActivation(context, pipeline, { roleId });
      } catch (error) {
        await replyV2(interaction, userMessage(error), { ephemeral: true });
        return true;
      }
    }
    await updateAndRender(interaction, context, `${pipeline}.roleId`, roleId, pipeline);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:riot:inspect') {
    await runManualInspection(interaction, context);
    return true;
  }

  const publishMatch = interaction.isButton()
    ? /^panel:riot:publish:([a-f\d]{24})$/iu.exec(interaction.customId)
    : null;
  if (publishMatch) {
    await confirmPublication(interaction, context, publishMatch[1]);
    return true;
  }

  const retryMatch = interaction.isButton()
    ? /^panel:riot:retry-failed:(patchNotes|updates)$/u.exec(interaction.customId)
    : null;
  if (retryMatch) {
    await reopenFailedPublication(interaction, context, retryMatch[1]);
    return true;
  }

  const toggleMatch = interaction.isButton()
    ? /^panel:riot:toggle:(patchNotes|updates)$/u.exec(interaction.customId)
    : null;
  if (toggleMatch) {
    const [, pipeline] = toggleMatch;
    const settings = await getRiotSettings(context.database);
    const enabling = !settings[pipeline].enabled;
    await interaction.deferUpdate();
    try {
      if (enabling) await validateRiotPipelineForActivation(context, pipeline);
      await updateRiotSetting(context.database, `${pipeline}.enabled`, enabling);
      const otherPipeline = pipeline === 'patchNotes' ? 'updates' : 'patchNotes';
      if (!enabling && !settings[otherPipeline].enabled) {
        await updateRiotSetting(context.database, 'scheduler.enabled', false);
      }
      await showRiotPage(interaction, context, pipeline, true);
    } catch (error) {
      await sendFollowupNotice(interaction, userMessage(error));
    }
    return true;
  }

  const webhookMatch = interaction.isButton()
    ? /^panel:riot:webhook:(patchNotes|updates)$/u.exec(interaction.customId)
    : null;
  if (webhookMatch) {
    const [, pipeline] = webhookMatch;
    const settings = await getRiotSettings(context.database);
    await interaction.deferUpdate();
    try {
      if (settings[pipeline].webhook?.id) await deleteRiotWebhook(context, pipeline);
      else await createRiotWebhook(context, pipeline);
      await showRiotPage(interaction, context, pipeline, true);
    } catch (error) {
      await sendFollowupNotice(interaction, userMessage(error));
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:riot:scheduler:toggle') {
    const settings = await getRiotSettings(context.database);
    const enabling = !settings.scheduler.enabled;
    if (enabling) {
      const enabledPipelines = ['patchNotes', 'updates'].filter((pipeline) => settings[pipeline].enabled);
      if (!enabledPipelines.length) {
        await replyV2(interaction, USER_MESSAGES.RIOT_SCHEDULER_REQUIRES_PIPELINE, { ephemeral: true });
        return true;
      }
      await interaction.deferUpdate();
      try {
        for (const pipeline of enabledPipelines) await validateRiotPipelineForActivation(context, pipeline);
        await updateRiotSetting(context.database, 'scheduler.enabled', true);
        await showRiotPage(interaction, context, 'scheduler', true);
      } catch (error) {
        await sendFollowupNotice(interaction, userMessage(error));
      }
    } else {
      await updateAndRender(interaction, context, 'scheduler.enabled', false, 'scheduler');
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:riot:scheduler:edit') {
    const settings = await getRiotSettings(context.database);
    await interaction.showModal(buildRiotScheduleModal(settings));
    return true;
  }

  const booleanSetting = interaction.isButton()
    ? /^(panel:riot:fallback:toggle|panel:riot:minor:toggle|panel:riot:major:toggle)$/u.exec(interaction.customId)
    : null;
  if (booleanSetting) {
    const settings = await getRiotSettings(context.database);
    const paths = {
      'panel:riot:fallback:toggle': ['fallbackEnglish', !settings.fallbackEnglish],
      'panel:riot:minor:toggle': ['scheduler.minorWindow.enabled', !settings.scheduler.minorWindow.enabled],
      'panel:riot:major:toggle': ['scheduler.majorWindow.enabled', !settings.scheduler.majorWindow.enabled],
    };
    const [path, value] = paths[interaction.customId];
    await updateAndRender(interaction, context, path, value, 'scheduler');
    return true;
  }

  const clearMatch = interaction.isButton()
    ? /^panel:riot:clear-(channel|role):(patchNotes|updates)$/u.exec(interaction.customId)
    : null;
  if (clearMatch) {
    const [, kind, pipeline] = clearMatch;
    const settings = await getRiotSettings(context.database);
    if (kind === 'channel' && settings[pipeline].webhook?.id) {
      await replyV2(interaction, 'Exclua o webhook atual antes de limpar o canal.', { ephemeral: true });
      return true;
    }
    await updateAndRender(interaction, context, `${pipeline}.${kind === 'channel' ? 'channelId' : 'roleId'}`, null, pipeline);
    return true;
  }

  return false;
}
