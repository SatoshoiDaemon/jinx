import { existsSync } from 'node:fs';
import path from 'node:path';

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function requiredValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new ConfigurationError(`Variável obrigatória ausente: ${name}.`);
  }

  return value;
}

export function loadConfig(environment = process.env) {
  const certificatePath = path.resolve(process.cwd(), 'certs/certificate.pem');
  if (!existsSync(certificatePath)) {
    throw new ConfigurationError('Certificado MongoDB ausente em certs/certificate.pem.');
  }

  return Object.freeze({
    discordToken: requiredValue(environment, 'DISCORD_TOKEN'),
    discordClientId: requiredValue(environment, 'DISCORD_CLIENT_ID'),
    mongoUri: requiredValue(environment, 'MONGODB_URI'),
    guildId: requiredValue(environment, 'GUILD_ID'),
    mongoCertificatePath: certificatePath,
  });
}
