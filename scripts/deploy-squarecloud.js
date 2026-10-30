import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SquareCloudAPI } from '@squarecloud/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function deploy() {
  const apiKey = process.env.SQUARECLOUD_API_KEY?.trim();
  const appId = process.env.SQUARECLOUD_APP_ID?.trim();
  const packagePath = process.env.SQUARECLOUD_ZIP_PATH?.trim();

  if (!apiKey) {
    throw new Error('SQUARECLOUD_API_KEY ausente.');
  }
  if (!appId) {
    throw new Error('SQUARECLOUD_APP_ID ausente.');
  }
  if (!packagePath) {
    throw new Error('Caminho do ZIP ausente.');
  }

  const absolutePackagePath = path.resolve(root, packagePath);
  const distDirectory = path.resolve(root, 'dist');
  const relativePackagePath = path.relative(distDirectory, absolutePackagePath);
  if (
    relativePackagePath.startsWith('..')
    || path.isAbsolute(relativePackagePath)
    || !relativePackagePath.endsWith('.zip')
    || !existsSync(absolutePackagePath)
    || !statSync(absolutePackagePath).isFile()
  ) {
    throw new Error('O ZIP de deploy não está em dist/.');
  }

  const api = new SquareCloudAPI(apiKey);
  await api.apps.commit(appId, absolutePackagePath);
  console.info('[Square Cloud] Arquivos enviados; reiniciando a aplicação.');
  await api.apps.restart(appId);
  console.info('[Square Cloud] Atualização enviada e reinicialização solicitada.');
}

deploy().catch((error) => {
  const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : '';
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? ` (${error.code})`
    : '';
  console.error(`[Square Cloud] Falha no deploy${status}${code}: ${error?.message === 'SQUARECLOUD_API_KEY ausente.' ? error.message : 'verifique a configuração e o acesso da API.'}`);
  process.exitCode = 1;
});
