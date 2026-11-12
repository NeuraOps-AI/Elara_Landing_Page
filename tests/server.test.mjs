import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { createElaraServer } from '../server.mjs';

const validEnquiry = {
  name: 'Test Visitor', email: 'visitor@example.com', phone: '+91 98765 43210',
  interest: '2 BHK', message: 'Please share the project details.', source: 'Integration test', document: 'both', consent: true,
};

test('enquiry capture, gated files, durable CRM and local request protections', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'elara-server-test-'));
  const config = { publicDir: path.join(directory, 'public'), dataDir: path.join(directory, 'data'), documentsDir: path.join(directory, 'private') };
  await Promise.all([mkdir(config.publicDir), mkdir(config.documentsDir)]);
  const brochure = Buffer.from('%PDF-1.4\nTest brochure fixture\n%%EOF');
  const priceSheet = Buffer.from('%PDF-1.4\nTest price sheet fixture\n%%EOF');
  await Promise.all([
    writeFile(path.join(config.publicDir, 'index.html'), '<h1>ELARA</h1>'),
    writeFile(path.join(config.publicDir, 'crm.html'), '<h1>Leads</h1>'),
    writeFile(path.join(config.documentsDir, 'ELARA-Brochure.pdf'), brochure),
    writeFile(path.join(config.documentsDir, 'ELARA-Price-Sheet.pdf'), priceSheet),
  ]);
  let server = await createElaraServer(config);
  async function listen() {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  let base = await listen();
  async function close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const post = (body, headers = {}) => fetch(`${base}/api/enquiries`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let created;

  await t.test('serves website and CRM and starts with zero leads', async () => {
    assert.match(await (await fetch(base)).text(), /ELARA/);
    assert.match(await (await fetch(`${base}/crm`)).text(), /Leads/);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).ok, true);
    assert.deepEqual((await (await fetch(`${base}/api/leads`)).json()).leads, []);
  });

  await t.test('rejects incomplete or oversized forms without creating records', async () => {
    const response = await post({ ...validEnquiry, email: 'invalid', phone: '123', consent: false });
    assert.equal(response.status, 422);
    const { fields } = await response.json();
    assert.ok(fields.email && fields.phone && fields.consent);
    assert.equal((await post({ ...validEnquiry, message: 'x'.repeat(33000) })).status, 413);
    assert.equal((await fetch(`${base}/api/enquiries`, { method: 'POST', body: 'hello' })).status, 415);
    assert.deepEqual((await (await fetch(`${base}/api/leads`)).json()).leads, []);
  });

  await t.test('rejects cross-origin requests and foreign Host headers', async () => {
    assert.equal((await post(validEnquiry, { Origin: 'https://foreign.example' })).status, 403);
    const foreignHostStatus = await new Promise((resolve, reject) => {
      const request = http.get(`${base}/api/leads`, { headers: { Host: 'foreign.example' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await post(validEnquiry, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  });

  await t.test('captures a valid enquiry and issues opaque download grants', async () => {
    const response = await post(validEnquiry, { Origin: base });
    assert.equal(response.status, 201);
    created = await response.json();
    assert.equal(created.lead.name, validEnquiry.name);
    assert.equal(created.lead.status, 'New');
    assert.equal(created.lead.notes, '');
    assert.deepEqual(created.lead.requestedDocuments, ['brochure', 'price-sheet']);
    assert.equal(created.downloads.length, 3);
    for (const download of created.downloads) {
      assert.match(download.url, /^\/api\/downloads\/(brochure|price-sheet|both)\?token=[A-Za-z0-9_-]{43}$/);
      assert.ok(Date.parse(download.expiresAt) > Date.now());
    }
    const persisted = JSON.parse(await readFile(path.join(config.dataDir, 'leads.json'), 'utf8'));
    assert.equal(persisted.leads.length, 1);
    assert.equal(persisted.grants.length, 3);
    assert.equal(JSON.stringify(persisted).includes(created.downloads[0].url.split('token=')[1]), false);
  });

  await t.test('gates PDFs server-side and returns real attachment bytes', async () => {
    assert.equal((await fetch(`${base}/api/downloads/brochure`)).status, 403);
    assert.equal((await fetch(`${base}/api/downloads/brochure?token=${'x'.repeat(43)}`)).status, 403);
    assert.equal((await fetch(`${base}/private/ELARA-Brochure.pdf`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e%2fprivate%2fELARA-Brochure.pdf`)).status, 404);
    for (const [kind, bytes] of [['brochure', brochure], ['price-sheet', priceSheet]]) {
      const url = created.downloads.find(download => download.document === kind).url;
      const response = await fetch(base + url);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-disposition'), /attachment/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    const brochureUrl = created.downloads[0].url;
    assert.equal((await fetch(base + brochureUrl.replace('/brochure?', '/price-sheet?'))).status, 403);
  });

  await t.test('bundles both PDFs in a valid stored ZIP', async () => {
    const response = await fetch(base + created.downloads.find(download => download.document === 'both').url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    const zip = Buffer.from(await response.arrayBuffer());
    let offset = 0;
    for (const [name, data] of [['ELARA-Brochure.pdf', brochure], ['ELARA-Price-Sheet.pdf', priceSheet]]) {
      assert.equal(zip.readUInt32LE(offset), 0x04034b50);
      const nameLength = zip.readUInt16LE(offset + 26);
      const size = zip.readUInt32LE(offset + 18);
      assert.equal(zip.subarray(offset + 30, offset + 30 + nameLength).toString(), name);
      assert.deepEqual(zip.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size), data);
      offset += 30 + nameLength + size;
    }
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.equal(zip.readUInt16LE(zip.length - 14), 2);
  });

  await t.test('updates status and notes, blocks invalid statuses and escapes CSV formula cells', async () => {
    const endpoint = `${base}/api/leads/${created.lead.id}`;
    const update = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Contacted', notes: '=HYPERLINK("unsafe")' }) });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).lead.status, 'Contacted');
    const invalid = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'INVALID' }) });
    assert.equal(invalid.status, 422);
    const response = await fetch(`${base}/api/leads/export`);
    assert.equal(response.status, 200);
    const csv = await response.text();
    assert.match(csv, /Test Visitor/);
    assert.match(csv, /"'=HYPERLINK\(""unsafe""\)"/);
    assert.match(csv, /"'\+91 98765 43210"/);
  });

  await t.test('serializes concurrent writes without losing enquiries', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, (_, index) => post({ ...validEnquiry, name: `Concurrent Visitor ${index}`, document: 'brochure' })));
    assert.ok(responses.every(response => response.status === 201));
    assert.equal((await (await fetch(`${base}/api/leads`)).json()).leads.length, 6);
    assert.equal(JSON.parse(await readFile(path.join(config.dataDir, 'leads.json'), 'utf8')).leads.length, 6);
  });

  await t.test('keeps lead updates and download grants after restart', async () => {
    await close();
    server = await createElaraServer(config);
    base = await listen();
    const records = (await (await fetch(`${base}/api/leads`)).json()).leads;
    assert.equal(records.length, 6);
    const lead = records.find(item => item.id === created.lead.id);
    assert.equal(lead.status, 'Contacted');
    assert.equal(lead.notes, '=HYPERLINK("unsafe")');
    assert.equal((await fetch(base + created.downloads[0].url)).status, 200);
  });

  await t.test('rejects expired grants', async () => {
    await close();
    const filename = path.join(config.dataDir, 'leads.json');
    const persisted = JSON.parse(await readFile(filename, 'utf8'));
    persisted.grants = persisted.grants.map(grant => ({ ...grant, expiresAt: '2000-01-01T00:00:00.000Z' }));
    await writeFile(filename, JSON.stringify(persisted));
    server = await createElaraServer(config);
    base = await listen();
    assert.equal((await fetch(base + created.downloads[0].url)).status, 403);
  });
});
