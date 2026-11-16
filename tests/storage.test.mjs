import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFileStore, createBlobStore } from '../storage.mjs';

const initial = { version: 1, leads: [], grants: [] };
function validate(value) {
  if (value?.version !== 1 || !Array.isArray(value.leads) || !Array.isArray(value.grants)) {
    throw new Error('Invalid database shape.');
  }
}

function fakeBlobs() {
  const entries = new Map();
  let sequence = 0;
  const calls = { reads: [], writes: [] };
  return {
    calls,
    async getWithMetadata(key, options) {
      calls.reads.push({ key, options });
      const saved = entries.get(key);
      return saved ? structuredClone(saved) : null;
    },
    async setJSON(key, value, condition) {
      calls.writes.push({ key, condition });
      const existing = entries.get(key);
      if (condition.onlyIfNew && existing) return { modified: false };
      if (condition.onlyIfMatch !== undefined && condition.onlyIfMatch !== existing?.etag) return { modified: false };
      const etag = `"revision-${++sequence}"`;
      entries.set(key, { data: structuredClone(value), etag, metadata: {} });
      return { modified: true, etag };
    },
  };
}

test('file store creates data on the first transaction and preserves the existing database format', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'elara-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'nested', 'leads.json');
  const store = await createFileStore(filename, initial, { validate });
  assert.deepEqual(await store.read(), initial);
  await assert.rejects(access(filename), { code: 'ENOENT' });

  const result = await store.transaction(db => { db.leads.push({ id: 'first' }); return db.leads[0]; });
  result.id = 'caller mutation';
  const reopened = await createFileStore(filename, initial, { validate });
  assert.deepEqual(await reopened.read(), { version: 1, leads: [{ id: 'first' }], grants: [] });
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), await reopened.read());

  const readResult = await store.read();
  readResult.leads.length = 0;
  assert.equal((await store.read()).leads.length, 1);
});

test('file transactions serialize concurrent callers and recover after a rejected change', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'elara-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'leads.json');
  const first = await createFileStore(filename, initial, { validate });
  const second = await createFileStore(filename, initial, { validate });
  await assert.rejects(first.transaction(db => { db.leads.push({ id: 'discard' }); throw new Error('Rejected'); }), /Rejected/);
  await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).transaction(db => {
    db.leads.push({ id: index });
  })));
  const saved = await second.read();
  assert.equal(saved.leads.length, 20);
  assert.deepEqual(saved.leads.map(lead => lead.id).sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index));
});

test('file store refuses corrupt JSON and invalid stored data without replacing it', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'elara-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'leads.json');
  for (const value of ['{broken', '{"version":2}']) {
    await writeFile(filename, value);
    await assert.rejects(createFileStore(filename, initial, { validate }));
    assert.equal(await readFile(filename, 'utf8'), value);
  }
});

test('blob store retries overlapping creation and updates across independent instances without losing changes', async () => {
  const blobs = fakeBlobs();
  const instances = Array.from({ length: 8 }, () => createBlobStore(blobs, 'leads', initial, { validate }));
  assert.equal(blobs.calls.writes.length, 0);
  await Promise.all(instances.map((store, index) => store.transaction(db => {
    db.leads.push({ id: index, status: 'New' });
    return db.leads.length;
  })));
  assert.equal((await instances[0].read()).leads.length, 8);
  await Promise.all(instances.map((store, index) => store.transaction(db => {
    db.leads.find(lead => lead.id === index).status = 'Contacted';
  })));
  const saved = await createBlobStore(blobs, 'leads', initial, { validate }).read();
  assert.equal(saved.leads.length, 8);
  assert.ok(saved.leads.every(lead => lead.status === 'Contacted'));
  assert.ok(blobs.calls.writes.some(call => call.condition.onlyIfNew === true));
  assert.ok(blobs.calls.writes.some(call => /^"revision-\d+"$/.test(call.condition.onlyIfMatch || '')));
  assert.ok(blobs.calls.reads.every(call => call.options.consistency === 'strong' && call.options.type === 'json'));
});

test('blob changes are isolated and a failed transaction does not write its partial draft', async () => {
  const blobs = fakeBlobs();
  const store = createBlobStore(blobs, 'leads', initial, { validate });
  const result = await store.transaction(db => { db.leads.push({ id: 'saved' }); return db.leads[0]; });
  result.id = 'mutated';
  await assert.rejects(store.transaction(db => { db.leads.push({ id: 'discard' }); throw new Error('Rejected'); }), /Rejected/);
  await assert.rejects(store.transaction(db => { db.version = 2; }), /Invalid database shape/);
  assert.deepEqual((await store.read()).leads, [{ id: 'saved' }]);
  assert.equal(blobs.calls.writes.length, 1);
  const value = await store.read();
  value.leads.length = 0;
  assert.equal((await store.read()).leads.length, 1);
});

test('blob store bounds conflicting writes and fails without claiming a successful save', async () => {
  const blobs = fakeBlobs();
  let writes = 0;
  blobs.setJSON = async () => { writes++; return { modified: false }; };
  const store = createBlobStore(blobs, 'leads', initial, { validate, maxAttempts: 3 });
  await assert.rejects(store.transaction(db => { db.leads.push({ id: 'unsaved' }); }), { status: 503, retryAfter: 1 });
  assert.equal(writes, 3);
  assert.deepEqual(await store.read(), initial);
});

test('blob store preserves remote errors and rejects missing versions or invalid data', async () => {
  const remoteError = new Error('Storage unavailable');
  const broken = createBlobStore({ getWithMetadata: async () => { throw remoteError; } }, 'leads', initial, { validate });
  await assert.rejects(broken.read(), error => error === remoteError);
  await assert.rejects(broken.transaction(() => {}), error => error === remoteError);
  const missingVersion = createBlobStore({ getWithMetadata: async () => ({ data: initial }) }, 'leads', initial, { validate });
  await assert.rejects(missingVersion.transaction(() => {}), /did not provide a version/);
  const corrupt = createBlobStore({ getWithMetadata: async () => ({ data: {}, etag: '"one"' }) }, 'leads', initial, { validate });
  await assert.rejects(corrupt.read(), /Invalid database shape/);
});

test('transaction callbacks must be synchronous so retries cannot repeat asynchronous side effects', async () => {
  const blobs = fakeBlobs();
  const store = createBlobStore(blobs, 'leads', initial, { validate });
  await assert.rejects(store.transaction(async db => { db.leads.push({ id: 'unsaved' }); }), /must be synchronous/);
  assert.equal(blobs.calls.writes.length, 0);
});
