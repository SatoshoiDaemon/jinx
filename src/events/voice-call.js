import { Events } from 'discord.js';
import { isAuthorizedGuild } from '../discord/guild.js';
import {
  cleanupTemporaryVoiceCalls,
  createTemporaryVoiceCall,
  deleteTemporaryVoiceCallIfEmpty,
  removeTemporaryVoiceCallRecord,
} from '../modules/voice-calls/service.js';

export function registerVoiceCallEvents(client, context) {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    if (
      !isAuthorizedGuild(newState.guild.id, context.guildId)
      || oldState.channelId === newState.channelId
    ) {
      return;
    }

    if (oldState.channelId) {
      const oldChannel = oldState.guild.channels.cache.get(oldState.channelId) ?? oldState.channel;
      try {
        await deleteTemporaryVoiceCallIfEmpty(oldChannel, context);
      } catch (error) {
        console.error(`[Calls] Falha ao remover uma call vazia (${error?.name ?? 'Erro'}).`);
      }
    }

    if (!newState.channelId) {
      return;
    }

    try {
      const member = newState.member ?? await newState.guild.members.fetch(newState.id);
      await createTemporaryVoiceCall(member, newState.channelId, newState.guild, context);
    } catch (error) {
      console.error(`[Calls] Falha ao criar ou mover para uma call (${error?.name ?? 'Erro'}).`);
    }
  });

  client.on(Events.ChannelDelete, async (channel) => {
    if (!isAuthorizedGuild(channel.guildId, context.guildId)) {
      return;
    }
    try {
      await removeTemporaryVoiceCallRecord(channel, context);
    } catch (error) {
      console.error(`[Calls] Falha ao limpar o registro de uma call (${error?.name ?? 'Erro'}).`);
    }
  });

  client.once(Events.ClientReady, async () => {
    try {
      await cleanupTemporaryVoiceCalls(client, context);
    } catch (error) {
      console.error(`[Calls] Falha ao recuperar calls temporárias (${error?.name ?? 'Erro'}).`);
    }
  });
}
