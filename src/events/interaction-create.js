import { Events } from 'discord.js';
import { handleInteraction, sendInteractionError } from '../commands/handler.js';

export function registerInteractionCreate(client, context) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleInteraction(interaction, context);
    } catch (error) {
      console.error(`[Discord] Falha ao processar interação (${error?.name ?? 'Erro'}).`);
      try {
        await sendInteractionError(interaction);
      } catch (responseError) {
        console.error(`[Discord] Falha ao responder à interação (${responseError?.name ?? 'Erro'}).`);
      }
    }
  });
}
