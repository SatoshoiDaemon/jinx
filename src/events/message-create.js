import { Events } from 'discord.js';
import { awardMessageXp } from '../modules/levels/service.js';
import { isAuthorizedGuild } from '../discord/guild.js';
import { isDiceExpression, rollDice } from '../modules/dice/roll.js';
import { DICE_LIMITS } from '../config/defaults.js';
import { v2ReplyPayload } from '../modules/common/components-v2.js';

function diceResultText(expression, result) {
  const modifier = result.modifier === 0
    ? ''
    : ` ${result.modifier > 0 ? '+' : '−'} ${Math.abs(result.modifier)}`;
  return `🎲 **${expression}** → resultados: ${result.results.join(', ')}${modifier}. Total: **${result.total}**.`;
}

async function handleDiceMessage(message) {
  const expression = message.content.trim();
  if (!isDiceExpression(expression)) {
    return;
  }

  try {
    const result = rollDice(expression);
    await message.reply(v2ReplyPayload(diceResultText(expression, result)));
  } catch (error) {
    if (error?.message !== 'DICE_LIMIT_EXCEEDED') {
      throw error;
    }
    await message.reply(v2ReplyPayload(
      `A expressão excede os limites: até ${DICE_LIMITS.maxDice} dados, ${DICE_LIMITS.maxFaces} faces e modificador de ${DICE_LIMITS.maxModifier}.`,
    ));
  }
}

export function registerMessageCreate(client, context) {
  client.on(Events.MessageCreate, async (message) => {
    if (
      !isAuthorizedGuild(message.guildId, context.guildId)
      || message.author.bot
    ) {
      return;
    }

    try {
      await handleDiceMessage(message);
    } catch (error) {
      console.error(`[Dados] Falha ao responder à expressão (${error?.name ?? 'Erro'}).`);
    }

    if (!message.member) {
      return;
    }

    try {
      await awardMessageXp(context.database, {
        userId: message.author.id,
        channelId: message.channelId,
        roleIds: message.member ? [...message.member.roles.cache.keys()] : [],
      });
    } catch (error) {
      console.error(`[Níveis] Falha ao conceder XP em mensagem (${error?.name ?? 'Erro'}).`);
    }
  });
}
