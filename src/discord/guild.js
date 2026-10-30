export function isAuthorizedGuild(actualGuildId, authorizedGuildId) {
  return typeof actualGuildId === 'string'
    && actualGuildId === authorizedGuildId;
}
