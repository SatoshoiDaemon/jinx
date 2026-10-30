import { Events } from 'discord.js';
import {
  handleTicketStaffRoleUpdate,
  handleTicketThreadDelete,
  recoverTicketJobs,
  recoverTicketSystem,
} from '../modules/tickets/service.js';
import { isAuthorizedGuild } from '../discord/guild.js';

export function registerTicketEvents(client, context) {
  client.on(Events.ThreadDelete, async (thread) => {
    if (!isAuthorizedGuild(thread.guildId, context.guildId)) return;
    try {
      await handleTicketThreadDelete(thread, { ...context, guild: thread.guild });
    } catch (error) {
      console.error(`[Tickets] Falha ao registrar exclusão de tópico (${error?.name ?? 'Erro'}).`);
    }
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (!isAuthorizedGuild(newMember.guild.id, context.guildId)) return;
    try {
      await handleTicketStaffRoleUpdate(oldMember, newMember, { ...context, guild: newMember.guild });
    } catch (error) {
      console.error(`[Tickets] Falha ao sincronizar acesso da equipe (${error?.name ?? 'Erro'}).`);
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    if (!isAuthorizedGuild(member.guild.id, context.guildId)) return;
    try {
      await handleTicketStaffRoleUpdate(
        { guild: member.guild, roles: { cache: new Map() } },
        member,
        { ...context, guild: member.guild },
      );
    } catch (error) {
      console.error(`[Tickets] Falha ao conceder acesso a novo membro da equipe (${error?.name ?? 'Erro'}).`);
    }
  });

  client.once(Events.ClientReady, async (readyClient) => {
    let guild;
    try {
      guild = await readyClient.guilds.fetch(context.guildId);
      const recoveryContext = { ...context, guild };
      await recoverTicketSystem(recoveryContext);
      console.info('[Tickets] Tickets persistidos reconciliados.');

      let recovering = false;
      const timer = setInterval(async () => {
        if (recovering) return;
        recovering = true;
        try {
          await recoverTicketJobs(recoveryContext);
        } catch (error) {
          console.error(`[Tickets] Falha na recuperação periódica (${error?.name ?? 'Erro'}).`);
        } finally {
          recovering = false;
        }
      }, 60_000);
      timer.unref?.();
    } catch (error) {
      console.error(`[Tickets] Falha na recuperação inicial (${error?.name ?? 'Erro'}).`);
    }
  });
}
