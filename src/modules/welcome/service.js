import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { DEFAULT_WELCOME_SETTINGS } from '../../config/defaults.js';
import { isAuthorizedGuild } from '../../discord/guild.js';
import { getModuleConfig } from '../../models/bot-config.js';
import { v2ReplyPayload } from '../common/components-v2.js';
import { resolveWelcomePlaceholders } from './placeholders.js';

export const PUBLIC_WELCOME_DELETE_AFTER_MS = 5000;

function cleanRoleIds(roleIds) {
  return Array.isArray(roleIds)
    ? [...new Set(roleIds.filter((roleId) => typeof roleId === 'string' && roleId.length > 0))].slice(0, 25)
    : [];
}

export async function getWelcomeSettings(database) {
  const stored = await getModuleConfig(database, 'welcome', DEFAULT_WELCOME_SETTINGS);
  return {
    initialRoles: {
      ...DEFAULT_WELCOME_SETTINGS.initialRoles,
      ...(stored.initialRoles ?? {}),
      enabled: stored.initialRoles?.enabled === true,
      roleIds: cleanRoleIds(stored.initialRoles?.roleIds),
    },
    directMessage: {
      ...DEFAULT_WELCOME_SETTINGS.directMessage,
      ...(stored.directMessage ?? {}),
      enabled: stored.directMessage?.enabled === true,
      content: typeof stored.directMessage?.content === 'string'
        ? stored.directMessage.content
        : DEFAULT_WELCOME_SETTINGS.directMessage.content,
    },
    publicMessage: {
      ...DEFAULT_WELCOME_SETTINGS.publicMessage,
      ...(stored.publicMessage ?? {}),
      enabled: stored.publicMessage?.enabled === true,
      channelId: typeof stored.publicMessage?.channelId === 'string'
        ? stored.publicMessage.channelId
        : null,
      content: typeof stored.publicMessage?.content === 'string'
        ? stored.publicMessage.content
        : DEFAULT_WELCOME_SETTINGS.publicMessage.content,
    },
  };
}

function welcomeAllowedMentions(userId) {
  return {
    parse: [],
    users: [userId],
    roles: [],
    repliedUser: false,
  };
}

export async function sendDirectWelcome(member, settings) {
  return member.send({
    ...v2ReplyPayload(resolveWelcomePlaceholders(settings.directMessage.content, member)),
    allowedMentions: welcomeAllowedMentions(member.user.id),
  });
}

function isUnknownMessage(error) {
  return error?.code === 10008
    || error?.rawError?.code === 10008
    || error?.code === 'UNKNOWN_MESSAGE';
}

export async function sendTemporaryPublicWelcome(channel, member, settings) {
  const message = await channel.send({
    ...v2ReplyPayload(resolveWelcomePlaceholders(settings.publicMessage.content, member)),
    allowedMentions: welcomeAllowedMentions(member.user.id),
  });

  setTimeout(() => {
    void message.delete().catch((error) => {
      if (isUnknownMessage(error)) {
        return;
      }
      console.error(`[Boas-vindas] Falha ao excluir mensagem pública temporária (${error?.name ?? 'Erro'}).`);
    });
  }, PUBLIC_WELCOME_DELETE_AFTER_MS);

  return message;
}

async function findPublicChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(channelId);
    } catch {
      return null;
    }
  }

  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    return null;
  }
  return channel;
}

export async function sendConfiguredPublicWelcome(member, settings) {
  const channel = await findPublicChannel(member.guild, settings.publicMessage.channelId);
  if (!channel) {
    throw new Error('WELCOME_CHANNEL_UNAVAILABLE');
  }
  return sendTemporaryPublicWelcome(channel, member, settings);
}

async function addInitialRoles(member, roleIds) {
  let botMember = member.guild.members.me;
  if (!botMember) {
    try {
      botMember = await member.guild.members.fetchMe();
    } catch {
      console.warn('[Boas-vindas] Não foi possível verificar os cargos do bot.');
      return;
    }
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.warn('[Boas-vindas] Cargos iniciais ignorados: falta a permissão Gerenciar cargos.');
    return;
  }

  for (const roleId of roleIds) {
    let role = member.guild.roles.cache.get(roleId);
    if (!role) {
      try {
        role = await member.guild.roles.fetch(roleId);
      } catch {
        role = null;
      }
    }

    if (!role) {
      console.warn(`[Boas-vindas] Cargo inicial ignorado: o cargo ${roleId} não existe mais.`);
      continue;
    }
    if (role.id === member.guild.id || role.managed) {
      console.warn(`[Boas-vindas] Cargo inicial ignorado: o cargo ${roleId} é gerenciado pelo Discord ou por integração.`);
      continue;
    }
    if (botMember.roles.highest.comparePositionTo(role) <= 0) {
      console.warn(`[Boas-vindas] Cargo inicial ignorado: o cargo ${roleId} não está abaixo do cargo mais alto do bot.`);
      continue;
    }
    if (member.roles.cache.has(roleId)) {
      continue;
    }

    try {
      await member.roles.add(role, 'Cargo inicial configurado no Jinx');
    } catch (error) {
      console.warn(`[Boas-vindas] Não foi possível atribuir o cargo inicial ${roleId} (${error?.name ?? 'Erro'}).`);
    }
  }
}

export async function processWelcomeMember(member, { database, guildId }) {
  if (!isAuthorizedGuild(member.guild.id, guildId)) {
    return;
  }

  let settings;
  try {
    settings = await getWelcomeSettings(database);
  } catch (error) {
    console.error(`[Boas-vindas] Falha ao consultar configurações (${error?.name ?? 'Erro'}).`);
    return;
  }

  if (settings.initialRoles.enabled && settings.initialRoles.roleIds.length > 0) {
    try {
      await addInitialRoles(member, settings.initialRoles.roleIds);
    } catch (error) {
      console.error(`[Boas-vindas] Falha ao atribuir cargos iniciais (${error?.name ?? 'Erro'}).`);
    }
  }

  if (settings.directMessage.enabled) {
    try {
      await sendDirectWelcome(member, settings);
    } catch {
      console.warn(`[Boas-vindas] Não foi possível enviar DM ao membro ${member.user.id}.`);
    }
  }

  if (settings.publicMessage.enabled) {
    try {
      await sendConfiguredPublicWelcome(member, settings);
    } catch (error) {
      if (error?.message === 'WELCOME_CHANNEL_UNAVAILABLE') {
        console.warn('[Boas-vindas] Canal da mensagem pública não configurado ou indisponível.');
      } else {
        console.warn(`[Boas-vindas] Não foi possível enviar mensagem pública (${error?.name ?? 'Erro'}).`);
      }
    }
  }
}
