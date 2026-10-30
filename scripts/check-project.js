import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectJavaScriptFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

function validateProjectConfiguration() {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (packageJson.type !== 'module' || packageJson.main !== 'index.js') {
    throw new Error('package.json precisa declarar ESM e index.js como entrada.');
  }

  const environmentExample = readFileSync(path.join(root, '.env.example'), 'utf8');
  const exampleNames = new Set(environmentExample
    .split(/\r?\n/)
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter(Boolean));
  const requiredEnvironmentNames = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'MONGODB_URI', 'GUILD_ID'];
  if (requiredEnvironmentNames.some((name) => !exampleNames.has(name))) {
    throw new Error('.env.example não lista todas as variáveis obrigatórias.');
  }

  const squareCloud = readFileSync(path.join(root, 'squarecloud.app'), 'utf8');
  const config = Object.fromEntries(squareCloud
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));

  const requiredKeys = ['MAIN', 'MEMORY', 'VERSION', 'DISPLAY_NAME'];
  if (requiredKeys.some((key) => !config[key])) {
    throw new Error('squarecloud.app não contém as configurações obrigatórias.');
  }
  if (!existsSync(path.join(root, config.MAIN))) {
    throw new Error('O arquivo MAIN configurado na Square Cloud não existe.');
  }
  const memory = Number(config.MEMORY);
  if (!Number.isSafeInteger(memory) || memory < 1 || !['recommended', 'latest'].includes(config.VERSION)) {
    throw new Error('MEMORY ou VERSION da Square Cloud é inválido.');
  }
  if (!/^[A-Za-z0-9 _-]{1,32}$/.test(config.DISPLAY_NAME)) {
    throw new Error('DISPLAY_NAME da Square Cloud é inválido.');
  }
  if (config.AUTORESTART && !['true', 'false'].includes(config.AUTORESTART)) {
    throw new Error('AUTORESTART da Square Cloud é inválido.');
  }
}

function validateSyntax() {
  const sourceFiles = [path.join(root, 'index.js')];
  for (const directory of ['src', 'scripts']) {
    sourceFiles.push(...collectJavaScriptFiles(path.join(root, directory)));
  }

  for (const filePath of sourceFiles) {
    const result = spawnSync(process.execPath, ['--check', filePath], { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      throw new Error(`Erro de sintaxe em ${path.relative(root, filePath)}.`);
    }
  }
}

try {
  validateProjectConfiguration();
  validateSyntax();
  console.info('Configuração e sintaxe válidas.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
