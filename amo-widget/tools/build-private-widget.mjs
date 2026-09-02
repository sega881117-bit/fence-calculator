import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const webhookUrl = process.env.FENCE_ADD_PDF_WEBHOOK_URL || '';
const version = process.env.FENCE_WIDGET_VERSION || JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).widget.version;
const outputDir = join(root, 'dist');
const outputFile = join(outputDir, `fence-assistant-widget-v${version}.zip`);
const files = ['manifest.json', 'script.js', 'style.css'];
const directories = ['i18n', 'images'];

if (!/^https:\/\/.+/.test(webhookUrl)) {
  throw new Error('Укажите FENCE_ADD_PDF_WEBHOOK_URL с HTTPS-адресом. Реальный URL не хранится в GitHub.');
}

const sourceScript = readFileSync(join(root, 'script.js'), 'utf8');
const marker = "var ADD_PDF_WEBHOOK_URL = '';";
if (!sourceScript.includes(marker)) {
  throw new Error('Не найден безопасный маркер PDF-конфигурации. Сборка остановлена.');
}

const stage = mkdtempSync(join(tmpdir(), 'fence-widget-'));
try {
  for (const file of files) cpSync(join(root, file), join(stage, file));
  for (const directory of directories) cpSync(join(root, directory), join(stage, directory), { recursive: true });
  writeFileSync(join(stage, 'script.js'), sourceScript.replace(marker, `var ADD_PDF_WEBHOOK_URL = ${JSON.stringify(webhookUrl)};`));

  mkdirSync(outputDir, { recursive: true });
  if (existsSync(outputFile)) rmSync(outputFile);
  execFileSync('zip', ['-q', '-r', outputFile, '.'], { cwd: stage });
  console.log(outputFile);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
