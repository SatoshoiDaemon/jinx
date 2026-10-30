import { randomInt } from 'node:crypto';
import { DICE_LIMITS } from '../../config/defaults.js';

const DICE_EXPRESSION = /^(\d+)d(\d+)([+-]\d+)?$/i;

export function isDiceExpression(expression) {
  return DICE_EXPRESSION.test(expression);
}

export function rollDice(expression) {
  const match = DICE_EXPRESSION.exec(expression);
  if (!match) {
    throw new Error('INVALID_DICE_EXPRESSION');
  }

  const diceCount = Number(match[1]);
  const faces = Number(match[2]);
  const modifier = Number(match[3] ?? 0);
  if (
    !Number.isSafeInteger(diceCount)
    || !Number.isSafeInteger(faces)
    || !Number.isSafeInteger(modifier)
    || diceCount < 1
    || diceCount > DICE_LIMITS.maxDice
    || faces < 2
    || faces > DICE_LIMITS.maxFaces
    || Math.abs(modifier) > DICE_LIMITS.maxModifier
  ) {
    throw new Error('DICE_LIMIT_EXCEEDED');
  }

  const results = Array.from({ length: diceCount }, () => randomInt(1, faces + 1));
  const total = results.reduce((sum, value) => sum + value, modifier);
  return { diceCount, faces, modifier, results, total };
}
