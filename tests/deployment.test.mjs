import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler, { config } from '../netlify/functions/elara.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Netlify build keeps protected HTML, documents and local state out of the CDN', async () => {
  await promisify(execFile)(process.execPath, ['scripts/build-netlify.mjs'], { cwd: root });
  const entries = await readdir(path.join(root, 'dist'), { recursive: true });
  assert.ok(entries.includes('index.html'));
  assert.ok(entries.includes('crm-login.css'));
  assert.ok(entries.includes('crm-login.js'));
  assert.ok(entries.includes('crm.js'));
  for (const entry of entries) {
    assert.doesNotMatch(entry.replaceAll('\\', '/'), /(^|\/)(crm\.html|crm-login\.html|data|private|\.env|crm-auth\.json)(\/|$)|\.pdf$/i);
  }
  assert.ok((await stat(path.join(root, 'dist/assets/elara-logo.png'))).size > 0);
  assert.deepEqual(config, { path: '/*', preferStatic: true });
  const toml = await readFile(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(toml, /publish = "dist"/);
  assert.match(toml, /directory = "netlify\/functions"/);
  assert.match(toml, /included_files = .*"public\/crm.html".*"private\/\*\.pdf"/);
});

test('replaced production deployments cannot open the current production CRM store', async () => {
  const response = await handler(new Request('https://old-deploy--elara.netlify.app/CRM/112026'), {
    deploy: { context: 'production', published: false, id: 'old-deploy' },
  });
  assert.equal(response.status, 410);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match((await response.json()).error, /current ELARA website/);
});
