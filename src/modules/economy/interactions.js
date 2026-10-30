import { handleBlackjackAction } from './games/service.js';

export async function handleEconomyInteraction(interaction, context) {
  if (!interaction.isButton()) {
    return false;
  }
  const match = /^economy:blackjack:([0-9a-f-]+):(\d+):(hit|stand)$/.exec(interaction.customId);
  if (!match) {
    return false;
  }
  return handleBlackjackAction(interaction, context, match);
}
