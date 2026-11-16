import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import { hashCrmPassword } from '../crm-auth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readPassword() {
  if (process.argv.includes('--stdin')) {
    process.stdout.write('Enter the CRM password through stdin (input is not printed).\n');
    let value = '';
    for await (const chunk of process.stdin) {
      value += chunk.toString('utf8');
      if (value.length > 1024) throw new Error('The password is too long.');
      const newline = value.indexOf('\n');
      if (newline !== -1) return value.slice(0, newline).replace(/\r$/, '');
    }
    return value;
  }
  if (!process.stdin.isTTY) throw new Error('Use --stdin when supplying the password through a pipe.');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write('New CRM password (12–256 characters; input hidden): ');
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Password change cancelled.')); }
      else if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (character && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(character) && value.length < 256) value += character;
    };
    process.stdin.on('keypress', onKey);
  });
}

try {
  const credential = await hashCrmPassword(await readPassword());
  const directory = path.join(root, 'data');
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'crm-auth.json');
  await writeFile(`${filename}.tmp`, JSON.stringify(credential, null, 2) + '\n', { mode: 0o600 });
  await rename(`${filename}.tmp`, filename);
  console.log('CRM password saved as a salted hash in local data. Restart the server to apply it.');
} catch (cause) {
  console.error(cause.message);
  process.exitCode = 1;
}
