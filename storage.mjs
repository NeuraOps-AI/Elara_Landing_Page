import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const fileQueues = new Map();
const clone = value => structuredClone(value);
const noValidation = () => {};

function applyChange(change, value) {
  const result = change(value);
  if (result && typeof result.then === 'function') {
    // A retried transaction must contain only synchronous changes to its draft.
    // Consume a rejected async callback so rejecting misuse does not leak one.
    Promise.resolve(result).catch(() => {});
    throw new TypeError('Store transaction callbacks must be synchronous.');
  }
  return clone(result);
}

/** A single-process local store; atomic replacement preserves the previous file on failure. */
export async function createFileStore(filename, initialValue, { validate = noValidation } = {}) {
  const absoluteFilename = path.resolve(filename);
  const initial = clone(initialValue);
  validate(initial);

  async function load() {
    let saved;
    try { saved = JSON.parse(await readFile(absoluteFilename, 'utf8')); }
    catch (cause) {
      if (cause.code === 'ENOENT') return clone(initial);
      throw new Error('Cannot read the data store. Existing data has been preserved.', { cause });
    }
    validate(saved);
    return saved;
  }

  // Reject corrupt existing data at startup, without creating a missing file.
  await load();
  return {
    async read() {
      await fileQueues.get(absoluteFilename);
      return load();
    },
    transaction(change) {
      const operation = (fileQueues.get(absoluteFilename) || Promise.resolve()).then(async () => {
        const next = await load();
        const result = applyChange(change, next);
        validate(next);
        const serialized = JSON.stringify(next, null, 2);
        if (serialized === undefined) throw new TypeError('Store values must be JSON serializable.');
        await mkdir(path.dirname(absoluteFilename), { recursive: true });
        const temporary = `${absoluteFilename}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, serialized, { mode: 0o600, flag: 'wx' });
          await rename(temporary, absoluteFilename);
        } finally {
          await unlink(temporary).catch(cause => { if (cause.code !== 'ENOENT') throw cause; });
        }
        return result;
      });
      const settled = operation.then(() => {}, () => {});
      fileQueues.set(absoluteFilename, settled);
      settled.then(() => {
        if (fileQueues.get(absoluteFilename) === settled) fileQueues.delete(absoluteFilename);
      });
      return operation;
    },
  };
}

/** A site-wide Netlify Blobs store with strong reads and conditional replacement. */
export function createBlobStore(blobStore, key, initialValue, { validate = noValidation, maxAttempts = 12 } = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('maxAttempts must be a positive integer.');
  const initial = clone(initialValue);
  validate(initial);

  async function load() {
    const entry = await blobStore.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (entry !== null && (typeof entry.etag !== 'string' || !entry.etag)) {
      throw new Error('The data store did not provide a version for this record.');
    }
    const value = clone(entry === null ? initial : entry.data);
    validate(value);
    return { value, etag: entry?.etag };
  }

  return {
    async read() { return (await load()).value; },
    async transaction(change) {
      // Only a successful conditional write may return the callback's result.
      // A concurrent writer forces a fresh read and reapplication to its value.
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { value, etag } = await load();
        const result = applyChange(change, value);
        validate(value);
        const condition = etag === undefined ? { onlyIfNew: true } : { onlyIfMatch: etag };
        const written = await blobStore.setJSON(key, value, condition);
        if (written?.modified === true) return result;
        if (written?.modified !== false) throw new Error('The data store did not confirm the write.');
        if (attempt + 1 < maxAttempts) await delay(Math.min(10 * 2 ** attempt, 160) + Math.floor(Math.random() * 10));
      }
      throw Object.assign(new Error('The data store is busy. Please try again.'), { status: 503, retryAfter: 1 });
    },
  };
}
