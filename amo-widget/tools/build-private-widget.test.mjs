import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const node = process.execPath;
const output = execFileSync(node, ['tools/build-private-widget.mjs'], {
  cwd: root,
  env: { ...process.env, FENCE_ADD_PDF_WEBHOOK_URL: 'https://example.invalid/private-pdf', FENCE_WIDGET_VERSION: 'test' },
  encoding: 'utf8'
}).trim();

if (!existsSync(output)) throw new Error('ZIP не создан');
const listing = execFileSync('unzip', ['-p', output, 'script.js'], { encoding: 'utf8' });
if (!listing.includes('https://example.invalid/private-pdf')) throw new Error('Закрытый URL не попал в рабочий ZIP');
if (readFileSync(join(root, 'script.js'), 'utf8').includes('example.invalid/private-pdf')) throw new Error('Исходник был изменён тестом');
rmSync(output, { force: true });
console.log('private widget build: all tests passed');
