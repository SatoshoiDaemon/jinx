const PLACEHOLDER_FORMATTERS = Object.freeze({
  'user.id': ({ member }) => member.user.id,
  'user.name': ({ member }) => member.user.username,
  'user.displayName': ({ member }) => member.displayName,
  'user.mention': ({ member }) => `<@${member.user.id}>`,
  'user.createdAt': ({ member }) => formatDate(member.user.createdAt),
  'guild.id': ({ guild }) => guild.id,
  'guild.name': ({ guild }) => guild.name,
  'guild.memberCount': ({ guild }) => String(guild.memberCount),
  'guild.ownerId': ({ guild }) => guild.ownerId,
  'guild.createdAt': ({ guild }) => formatDate(guild.createdAt),
});

export const WELCOME_PLACEHOLDERS = Object.freeze([
  { placeholder: '{user.id}', description: 'ID do membro' },
  { placeholder: '{user.name}', description: 'Nome de usuário' },
  { placeholder: '{user.displayName}', description: 'Nome de exibição no servidor' },
  { placeholder: '{user.mention}', description: 'Menção ao membro' },
  { placeholder: '{user.createdAt}', description: 'Data de criação da conta' },
  { placeholder: '{guild.id}', description: 'ID do servidor' },
  { placeholder: '{guild.name}', description: 'Nome do servidor' },
  { placeholder: '{guild.memberCount}', description: 'Quantidade atual de membros' },
  { placeholder: '{guild.ownerId}', description: 'ID do proprietário' },
  { placeholder: '{guild.createdAt}', description: 'Data de criação do servidor' },
]);

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value ?? '');
  }

  return `${new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)} (UTC)`;
}

export function resolveWelcomePlaceholders(content, member) {
  const context = { member, guild: member.guild };
  return String(content).replace(/\{([A-Za-z]+\.[A-Za-z]+)\}/g, (placeholder, key) => {
    const formatter = PLACEHOLDER_FORMATTERS[key];
    return formatter ? String(formatter(context)) : placeholder;
  });
}
