import { commandsByName } from './registry.js';
import { editReplyV2, replyV2 } from '../modules/common/components-v2.js';
import { handlePanelInteraction } from '../modules/panel/service.js';
import { isAuthorizedGuild } from '../discord/guild.js';

export async function handleInteraction(interaction, context) {
  if (!isAuthorizedGuild(interaction.guildId, context.guildId)) {
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = commandsByName.get(interaction.commandName);
    if (!command) {
      await replyV2(interaction, 'Este comando não está disponível.', { ephemeral: true });
      return;
    }

    await command.execute(interaction, context);
    return;
  }

  const handled = await handlePanelInteraction(interaction, context);
  if (
    !handled
    && (interaction.isButton() || interaction.isRoleSelectMenu()
      || interaction.isChannelSelectMenu() || interaction.isStringSelectMenu()
      || interaction.isModalSubmit())
  ) {
    await replyV2(interaction, 'Este componente não está mais disponível. Abra o painel novamente.', { ephemeral: true });
  }
}

export async function sendInteractionError(interaction) {
  const message = 'Não foi possível concluir essa ação. Tente novamente em instantes.';
  if (interaction.deferred || interaction.replied) {
    await editReplyV2(interaction, message);
    return;
  }

  await replyV2(interaction, message, { ephemeral: true });
}
