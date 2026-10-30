import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFiles = [
  path.join(root, '.env'),
  path.join(root, 'certs/certificate.pem'),
];

function decodeSecret(name) {
  const encoded = process.env[name];
  if (!encoded) {
    throw new Error(`Secret ausente: ${name}.`);
  }

  const normalized = encoded.replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new Error(`Secret Base64 inválido: ${name}.`);
  }
  const decoded = Buffer.from(normalized, 'base64');
  if (!decoded.length || decoded.toString('base64') !== normalized) {
    throw new Error(`Secret Base64 inválido: ${name}.`);
  }
  return decoded;
}

try {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Este script só pode ser executado em um runner do GitHub Actions.');
  }
  if (outputFiles.some((filePath) => existsSync(filePath))) {
    throw new Error('Um arquivo de destino já existe; nenhum arquivo foi alterado.');
  }

  const environmentFile = decodeSecret('JINX_ENV_FILE_BASE64');
  const certificate = decodeSecret('JINX_MONGODB_CERTIFICATE_PEM_BASE64');
  mkdirSync(path.dirname(outputFiles[1]), { recursive: true });
  writeFileSync(outputFiles[0], environmentFile, { flag: 'wx', mode: 0o600 });
  writeFileSync(outputFiles[1], certificate, { flag: 'wx', mode: 0o600 });
  console.info('Arquivos privados recriados no runner.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
