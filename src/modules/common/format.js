import { escapeMarkdown } from 'discord.js';

export function formatDuration(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  return [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes ? `${minutes}min` : null,
    `${remainder}s`,
  ].filter(Boolean).join(' ');
}

export function escapeDiscordText(value) {
  return escapeMarkdown(String(value)).replaceAll('@', '@\u200b');
}
