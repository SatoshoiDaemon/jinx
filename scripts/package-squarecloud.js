import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  '.env',
  'certs/certificate.pem',
  'index.js',
  'package.json',
  'package-lock.json',
  'squarecloud.app',
];
const packagePaths = [
  'index.js',
  'package.json',
  'package-lock.json',
  'src',
  'squarecloud.app',
  '.env',
  'certs/certificate.pem',
];

function existsAsFile(relativePath) {
  const filePath = path.join(root, relativePath);
  return existsSync(filePath) && statSync(filePath).isFile();
}

const missingFiles = requiredFiles.filter((filePath) => !existsAsFile(filePath));
const sourceDirectory = path.join(root, 'src');
if (missingFiles.length || !existsSync(sourceDirectory) || !statSync(sourceDirectory).isDirectory()) {
  if (!existsSync(sourceDirectory) || !statSync(sourceDirectory).isDirectory()) {
    missingFiles.push('src/');
  }
  console.error(`Não foi possível montar o ZIP: falta(m) ${missingFiles.join(', ')}.`);
  process.exitCode = 1;
} else {
  const distDirectory = path.join(root, 'dist');
  mkdirSync(distDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zipPath = path.join(distDirectory, `jinx-squarecloud-${timestamp}.zip`);
  const result = spawnSync('zip', ['-q', '-r', zipPath, ...packagePaths], {
    cwd: root,
    stdio: 'ignore',
  });

  if (result.error || result.status !== 0) {
    console.error('Não foi possível montar o ZIP local da Square Cloud.');
    process.exitCode = 1;
  } else {
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `zip_path=${zipPath}\n`);
    }
    console.info(`ZIP local criado em ${path.relative(root, zipPath)}.`);
  }
}
