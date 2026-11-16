import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public');
const output = path.join(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Invalid build directory.');
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const entry of await readdir(source)) {
  // HTML must go through the server's password check, never Netlify's CDN.
  if (['crm.html', 'crm-login.html'].includes(entry.toLowerCase())) continue;
  await cp(path.join(source, entry), path.join(output, entry), { recursive: true });
}
console.log('Netlify static files built in dist; CRM HTML and private documents remain server-only.');
