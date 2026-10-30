import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { DEFAULT_VOICE_CALL_SETTINGS } from '../../config/defaults.js';
import { getModuleConfig } from '../../models/bot-config.js';

const TEMPORARY_VOICE_CHANNELS_COLLECTION = 'temporary_voice_channels';
const pendingCreations = new Map();
const deletingChannels = new Set();

function callsCollection(database) {
  return database.collection(TEMPORARY_VOICE_CHANNELS_COLLECTION);
}

function hasConnectedMembers(channel) {
  return channel.guild.voiceStates.cache.some((state) => state.channelId === channel.id);
}

function channelName(member) {
  const name = (member.displayName?.trim() || member.user.username).replace(/\s+/g, ' ');
  return Array.from(name).slice(0, 100).join('') || 'call';
}

async function discardNewChannel(channel, context) {
  try {
    await channel.delete('A pessoa saiu do canal base antes de entrar na call temporária.');
    await callsCollection(context.database).deleteOne({ _id: channel.id });
  } catch (error) {
    if (error?.code === 10003) {
      await callsCollection(context.database).deleteOne({ _id: channel.id });
      return;
    }
    throw error;
  }
}

async function createAndMove(member, baseChannelId, guild, context) {
  const settings = await getModuleConfig(
    context.database,
    'voice_calls',
    DEFAULT_VOICE_CALL_SETTINGS,
  );
  if (settings.baseChannelId !== baseChannelId || !settings.categoryId) {
    return;
  }

  const baseChannel = guild.channels.cache.get(settings.baseChannelId);
  const category = guild.channels.cache.get(settings.categoryId);
  if (
    baseChannel?.type !== ChannelType.GuildVoice
    || category?.type !== ChannelType.GuildCategory
    || member.voice.channelId !== baseChannel.id
  ) {
    return;
  }

  const channel = await guild.channels.create({
    name: channelName(member),
    type: ChannelType.GuildVoice,
    parent: category.id,
    userLimit: 0,
    permissionOverwrites: [{
      id: guild.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    }],
    reason: `Call temporária de ${member.user.tag ?? member.user.username}`,
  });

  try {
    await callsCollection(context.database).insertOne({
      _id: channel.id,
      guildId: guild.id,
      ownerId: member.id,
      createdAt: new Date(),
    });
  } catch (error) {
    try {
      await channel.delete('Não foi possível registrar a call temporária.');
    } catch {
      // Mantém o erro original para o log do evento.
    }
    throw error;
  }

  if (member.voice.channelId !== baseChannel.id) {
    await discardNewChannel(channel, context);
    return;
  }

  try {
    await member.voice.setChannel(channel, 'Entrada no canal base de calls temporárias.');
  } catch (error) {
    await discardNewChannel(channel, context);
    throw error;
  }
}

export async function createTemporaryVoiceCall(member, baseChannelId, guild, context) {
  if (member.user.bot) {
    return;
  }

  const key = `${guild.id}:${member.id}`;
  const pending = pendingCreations.get(key);
  if (pending) {
    await pending;
    return;
  }

  const creation = createAndMove(member, baseChannelId, guild, context);
  pendingCreations.set(key, creation);
  try {
    await creation;
  } finally {
    pendingCreations.delete(key);
  }
}

export async function deleteTemporaryVoiceCallIfEmpty(channel, context) {
  if (!channel || channel.type !== ChannelType.GuildVoice || hasConnectedMembers(channel)) {
    return false;
  }

  const calls = callsCollection(context.database);
  const record = await calls.findOne({ _id: channel.id, guildId: channel.guildId });
  if (!record || deletingChannels.has(channel.id)) {
    return false;
  }

  const claim = await calls.updateOne(
    { _id: channel.id, guildId: channel.guildId, deleting: { $ne: true } },
    { $set: { deleting: true } },
  );
  if (!claim.modifiedCount) {
    return false;
  }

  deletingChannels.add(channel.id);
  try {
    const currentChannel = channel.guild.channels.cache.get(channel.id) ?? channel;
    if (hasConnectedMembers(currentChannel)) {
      await calls.updateOne({ _id: channel.id }, { $unset: { deleting: '' } });
      return false;
    }

    await currentChannel.delete('Call temporária vazia.');
    await calls.deleteOne({ _id: channel.id });
    return true;
  } catch (error) {
    if (error?.code === 10003) {
      await calls.deleteOne({ _id: channel.id });
      return true;
    }
    await calls.updateOne({ _id: channel.id }, { $unset: { deleting: '' } });
    throw error;
  } finally {
    deletingChannels.delete(channel.id);
  }
}

export async function cleanupTemporaryVoiceCalls(client, context) {
  const calls = callsCollection(context.database);
  await calls.updateMany({ guildId: context.guildId }, { $unset: { deleting: '' } });
  const records = await calls.find({ guildId: context.guildId }).toArray();

  for (const record of records) {
    try {
      const guild = client.guilds.cache.get(record.guildId);
      const channel = guild?.channels.cache.get(record._id);
      if (!guild || !channel) {
        await calls.deleteOne({ _id: record._id });
        continue;
      }
      await deleteTemporaryVoiceCallIfEmpty(channel, context);
    } catch (error) {
      console.error(`[Calls] Falha ao reconciliar uma call temporária (${error?.name ?? 'Erro'}).`);
    }
  }
}

export async function removeTemporaryVoiceCallRecord(channel, context) {
  await callsCollection(context.database).deleteOne({
    _id: channel.id,
    guildId: channel.guildId,
  });
}
