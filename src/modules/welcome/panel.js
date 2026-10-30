import { ChannelType } from 'discord.js';
import { DEFAULT_WELCOME_SETTINGS } from '../../config/defaults.js';
import { updateModuleConfigValue } from '../../models/bot-config.js';
import { editReplyV2, replyV2, v2EditPayload } from '../common/components-v2.js';
import {
  buildPanelRows,
  buildWelcomeMessageModal,
  renderPanelContent,
} from '../panel/components.js';
import {
  getWelcomeSettings,
  sendConfiguredPublicWelcome,
  sendDirectWelcome,
} from './service.js';

const SECTION_BY_SETTING = Object.freeze({
  initialRoles: 'roles',
  directMessage: 'dm',
  publicMessage: 'public',
});

async function updateWelcomePage(interaction, context, section, path, value) {
  await interaction.deferUpdate();
  await updateModuleConfigValue(context.database, 'welcome', path, value);
  const settings = await getWelcomeSettings(context.database);
  await interaction.editReply(v2EditPayload(
    renderPanelContent('welcome', settings, interaction.guild, section),
    { rows: buildPanelRows('welcome', section, settings) },
  ));
}

async function showWelcomeSection(interaction, context, section) {
  await interaction.deferUpdate();
  const settings = await getWelcomeSettings(context.database);
  await interaction.editReply(v2EditPayload(
    renderPanelContent('welcome', settings, interaction.guild, section),
    { rows: buildPanelRows('welcome', section, settings) },
  ));
}

async function showMessageModal(interaction, database, kind) {
  const settings = await getWelcomeSettings(database);
  const settingKey = kind === 'dm' ? 'directMessage' : 'publicMessage';
  const defaultContent = DEFAULT_WELCOME_SETTINGS[settingKey].content;
  await interaction.showModal(buildWelcomeMessageModal(
    kind,
    settings[settingKey].content || defaultContent,
  ));
}

async function saveMessageModal(interaction, context, kind) {
  const content = interaction.fields.getTextInputValue('content');
  if (!content.trim()) {
    await replyV2(interaction, 'A mensagem precisa ter algum conteúdo.', { ephemeral: true });
    return true;
  }
  if (!interaction.isFromMessage()) {
    await replyV2(interaction, 'Abra o editor pelo painel e tente novamente.', { ephemeral: true });
    return true;
  }

  const settingKey = kind === 'dm' ? 'directMessage' : 'publicMessage';
  const section = SECTION_BY_SETTING[settingKey];
  await interaction.deferUpdate();
  await updateModuleConfigValue(context.database, 'welcome', `${settingKey}.content`, content);
  const settings = await getWelcomeSettings(context.database);
  await interaction.editReply(v2EditPayload(
    renderPanelContent('welcome', settings, interaction.guild, section),
    { rows: buildPanelRows('welcome', section, settings) },
  ));
  return true;
}

async function sendDmPreview(interaction, context) {
  await replyV2(interaction, 'Enviando a prévia para sua DM…', { ephemeral: true });
  try {
    const settings = await getWelcomeSettings(context.database);
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await sendDirectWelcome(member, settings);
    await editReplyV2(interaction, 'Prévia enviada por mensagem privada.');
  } catch {
    await editReplyV2(
      interaction,
      'Não foi possível enviar a prévia. Confira se suas mensagens privadas estão abertas para o servidor.',
    );
  }
}

async function sendPublicPreview(interaction, context) {
  await replyV2(interaction, 'Enviando o teste para o canal configurado…', { ephemeral: true });
  try {
    const settings = await getWelcomeSettings(context.database);
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await sendConfiguredPublicWelcome(member, settings);
    await editReplyV2(interaction, 'Teste enviado. A mensagem será removida após 5 segundos.');
  } catch {
    await editReplyV2(
      interaction,
      'Não foi possível enviar o teste. Confira o canal configurado e as permissões do Jinx nele.',
    );
  }
}

export async function handleWelcomePanelInteraction(interaction, context) {
  if (!interaction.customId?.startsWith('panel:welcome:')) {
    return false;
  }

  if (interaction.isModalSubmit()) {
    const match = /^panel:welcome:(dm|public):modal$/.exec(interaction.customId);
    if (match) {
      return saveMessageModal(interaction, context, match[1]);
    }
    return false;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:welcome:section') {
    const section = interaction.values[0];
    await showWelcomeSection(interaction, context, section);
    return true;
  }

  const toggleMatch = interaction.isButton()
    ? /^panel:welcome:(initialRoles|directMessage|publicMessage):toggle$/.exec(interaction.customId)
    : null;
  if (toggleMatch) {
    const settingKey = toggleMatch[1];
    const section = SECTION_BY_SETTING[settingKey];
    await interaction.deferUpdate();
    const settings = await getWelcomeSettings(context.database);
    const enabled = !settings[settingKey].enabled;
    await updateModuleConfigValue(context.database, 'welcome', `${settingKey}.enabled`, enabled);
    const updatedSettings = await getWelcomeSettings(context.database);
    await interaction.editReply(v2EditPayload(
      renderPanelContent('welcome', updatedSettings, interaction.guild, section),
      { rows: buildPanelRows('welcome', section, updatedSettings) },
    ));
    return true;
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'panel:welcome:roles:select') {
    const roleIds = [...new Set(interaction.values)].slice(0, 25);
    await updateWelcomePage(interaction, context, 'roles', 'initialRoles.roleIds', roleIds);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:welcome:roles:clear') {
    await updateWelcomePage(interaction, context, 'roles', 'initialRoles.roleIds', []);
    return true;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'panel:welcome:public:channel') {
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      await replyV2(interaction, 'O canal selecionado não está mais disponível.', { ephemeral: true });
      return true;
    }
    await updateWelcomePage(
      interaction,
      context,
      'public',
      'publicMessage.channelId',
      channel.id,
    );
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:welcome:public:channel:clear') {
    await updateWelcomePage(interaction, context, 'public', 'publicMessage.channelId', null);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:welcome:dm:edit') {
    await showMessageModal(interaction, context.database, 'dm');
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:welcome:public:edit') {
    await showMessageModal(interaction, context.database, 'public');
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:welcome:dm:preview') {
    await sendDmPreview(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:welcome:public:test') {
    await sendPublicPreview(interaction, context);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:welcome:dm:reset') {
    await updateWelcomePage(
      interaction,
      context,
      'dm',
      'directMessage.content',
      DEFAULT_WELCOME_SETTINGS.directMessage.content,
    );
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'panel:welcome:public:reset') {
    await updateWelcomePage(
      interaction,
      context,
      'public',
      'publicMessage.content',
      DEFAULT_WELCOME_SETTINGS.publicMessage.content,
    );
    return true;
  }

  return false;
}
