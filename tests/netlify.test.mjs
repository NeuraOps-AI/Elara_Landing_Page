import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNetlifyHandler } from '../netlify-app.mjs';

const SITE = 'https://elaravillas.com';
const PASSWORD = 'Netlify-Fixture-Only!42';
const enquiry = {
  name: 'Hosted Test Visitor', email: 'hosted-visitor@example.com', phone: '+91 98765 43210',
  interest: 'Private visit', message: 'Please share the project details.', source: 'Netlify integration test',
  document: 'both', consent: true,
};
const brochure = Buffer.from('%PDF-1.4\nHosted brochure fixture\n%%EOF');
const priceSheet = Buffer.from('%PDF-1.4\nHosted price sheet fixture\n%%EOF');

// Models the documented Netlify conditional-write contract, including a fresh
// snapshot for each read. Separate handler instances share only this backing.
function blobFixture() {
  const entries = new Map();
  let revision = 0;
  return {
    async getWithMetadata(key, options) {
      assert.equal(options.type, 'json');
      assert.equal(options.consistency, 'strong');
      return entries.has(key) ? structuredClone(entries.get(key)) : null;
    },
    async setJSON(key, data, options) {
      const entry = entries.get(key);
      if ((options.onlyIfNew && entry) || (options.onlyIfMatch && entry?.etag !== options.onlyIfMatch)) {
        return { modified: false };
      }
      const etag = `revision-${++revision}`;
      entries.set(key, { data: structuredClone(data), etag, metadata: {} });
      return { modified: true, etag };
    },
  };
}

async function fixture(t, { configured = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'elara-netlify-test-'));
  const options = {
    blobStore: blobFixture(),
    publicDir: path.join(directory, 'public'),
    documentsDir: path.join(directory, 'private'),
    siteOrigin: SITE,
    ...(configured ? { crmPassword: PASSWORD } : {}),
  };
  await Promise.all([mkdir(options.publicDir), mkdir(options.documentsDir)]);
  await Promise.all([
    writeFile(path.join(options.publicDir, 'index.html'), '<h1>Public ELARA landing page</h1>'),
    writeFile(path.join(options.publicDir, 'crm-login.html'), '<h1>CRM SIGN-IN</h1><input type="password">'),
    writeFile(path.join(options.publicDir, 'crm.html'), '<h1>PRIVATE-DASHBOARD</h1>'),
    writeFile(path.join(options.documentsDir, 'ELARA-Brochure.pdf'), brochure),
    writeFile(path.join(options.documentsDir, 'ELARA-Price-Sheet.pdf'), priceSheet),
  ]);
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  async function instance(overrides = {}) {
    const previous = process.env.CRM_PASSWORD;
    delete process.env.CRM_PASSWORD;
    let handler;
    try { handler = await createNetlifyHandler({ ...options, ...overrides }); }
    finally { if (previous !== undefined) process.env.CRM_PASSWORD = previous; }
    const request = (pathname, init = {}, context = {}) => handler(new Request(SITE + pathname, init), {
      ip: '192.0.2.25', site: { id: 'fixture-site', url: SITE, name: 'elara-fixture' },
      deploy: { id: 'fixture-deploy', context: 'production', published: true }, ...context,
    });
    const json = (pathname, payload, headers = {}, method = 'POST') => request(pathname, {
      method, headers: { 'Content-Type': 'application/json', Origin: SITE, ...headers }, body: JSON.stringify(payload),
    });
    return { request, json, login: (password = PASSWORD, headers = {}) => json('/api/crm/login', { password }, headers) };
  }
  return { ...await instance(), instance, directory };
}

async function signIn(app) {
  const response = await app.login();
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('Netlify CRM deep link serves sign-in and persists secure sessions across function instances', async t => {
  const app = await fixture(t);
  const loginPage = await app.request('/CRM/112026');
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /CRM SIGN-IN/);
  assert.match(loginPage.headers.get('cache-control'), /no-store/);
  assert.equal((await app.request('/CRM/112026', { method: 'HEAD' })).status, 200);
  assert.equal((await app.login('Wrong-Fixture-Password')).status, 401);
  const login = await app.login();
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { ok: true });
  const cookieHeader = login.headers.get('set-cookie');
  assert.match(cookieHeader, /^elara_crm_session=[A-Za-z0-9_-]{43};/);
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Max-Age=28800']) {
    assert.ok(cookieHeader.includes(attribute), attribute);
  }
  assert.equal(cookieHeader.includes(PASSWORD), false);
  const cookie = cookieHeader.split(';')[0];
  const fresh = await app.instance();
  const dashboard = await fresh.request('/CRM/112026', { headers: { Cookie: cookie } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /PRIVATE-DASHBOARD/);
  assert.equal((await fresh.request('/api/crm/session', { headers: { Cookie: cookie } })).status, 200);
  const logout = await fresh.request('/api/crm/logout', { method: 'POST', headers: { Cookie: cookie, Origin: SITE } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await app.request('/api/leads', { headers: { Cookie: cookie } })).status, 401);
  assert.match(await (await app.request('/CRM/112026', { headers: { Cookie: cookie } })).text(), /CRM SIGN-IN/);
});

test('Netlify enquiries, lead edits and download grants survive cold starts', async t => {
  const app = await fixture(t);
  const response = await app.json('/api/enquiries', enquiry);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.lead.name, enquiry.name);
  assert.equal(created.downloads.length, 3);
  const cookie = await signIn(app);
  const fresh = await app.instance();
  const records = await (await fresh.request('/api/leads', { headers: { Cookie: cookie } })).json();
  assert.equal(records.leads.length, 1);
  assert.equal(records.leads[0].id, created.lead.id);
  const changed = await fresh.json(`/api/leads/${created.lead.id}`, { status: 'Contacted', notes: 'Hosted follow-up' }, { Cookie: cookie }, 'PATCH');
  assert.equal(changed.status, 200);
  const another = await app.instance();
  const persisted = await (await another.request('/api/leads', { headers: { Cookie: cookie } })).json();
  assert.equal(persisted.leads[0].status, 'Contacted');
  assert.equal(persisted.leads[0].notes, 'Hosted follow-up');
  const csv = await another.request('/api/leads/export', { headers: { Cookie: cookie } });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Hosted Test Visitor/);
  assert.equal((await another.request('/api/downloads/brochure')).status, 403);
  assert.equal((await another.request('/api/downloads/brochure?token=' + 'x'.repeat(43))).status, 403);
  for (const [kind, expected] of [['brochure', brochure], ['price-sheet', priceSheet]]) {
    const download = await another.request(created.downloads.find(item => item.document === kind).url);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), expected);
  }
  const bundle = await another.request(created.downloads.find(item => item.document === 'both').url);
  assert.equal(bundle.status, 200);
  assert.equal(bundle.headers.get('content-type'), 'application/zip');
  const zip = Buffer.from(await bundle.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.ok(zip.includes(brochure));
  assert.ok(zip.includes(priceSheet));
});

test('Netlify wrong page URLs redirect home while protected APIs and missing assets retain errors', async t => {
  const app = await fixture(t);
  for (const pathname of ['/wrong-url', '/CRM/999999', '/crm', '/crm.html', '/CRM.HTML', '/crm-login.html', '/missing.html']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await app.request(pathname, { method });
      assert.equal(response.status, 302, `${method} ${pathname}`);
      assert.equal(response.headers.get('location'), '/');
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.equal(await response.text(), '');
    }
  }
  assert.match(await (await app.request('/')).text(), /Public ELARA landing page/);
  assert.equal((await app.request('/api/not-an-endpoint')).status, 404);
  assert.equal((await app.request('/api/leads')).status, 401);
  assert.equal((await app.request('/assets/missing.js', { headers: { 'Sec-Fetch-Dest': 'script' } })).status, 404);
  assert.equal((await app.request('/wrong-url', { method: 'POST' })).status, 405);
  const privateDocument = await app.request('/private/ELARA-Brochure.pdf', { headers: { Accept: 'text/html' } });
  assert.equal(privateDocument.status, 302);
  assert.equal(privateDocument.headers.get('location'), '/');
  assert.equal(await privateDocument.text(), '');
});

test('Netlify rejects cross-origin submissions and forged CRM sessions', async t => {
  const app = await fixture(t);
  assert.equal((await app.login(PASSWORD, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await app.login(PASSWORD, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await app.json('/api/enquiries', enquiry, { Origin: 'https://foreign.example' })).status, 403);
  const forged = { Cookie: `elara_crm_session=${'a'.repeat(43)}` };
  assert.equal((await app.request('/api/leads', { headers: forged })).status, 401);
  assert.equal((await app.request('/api/leads/export', { headers: forged })).status, 401);
  assert.equal((await app.json('/api/leads/00000000-0000-0000-0000-000000000000', { status: 'Closed' }, forged, 'PATCH')).status, 401);
  const cookie = await signIn(app);
  assert.equal((await app.request('/api/crm/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await app.request('/api/crm/session', { headers: { Cookie: cookie } })).status, 200);
});

test('Netlify without a configured password fails closed and preserves public enquiry capture', async t => {
  const app = await fixture(t, { configured: false });
  const login = await app.request('/CRM/112026');
  assert.equal(login.status, 200);
  assert.match(await login.text(), /CRM SIGN-IN/);
  assert.equal((await app.login()).status, 503);
  assert.equal((await app.request('/api/leads')).status, 401);
  assert.equal((await app.json('/api/enquiries', enquiry)).status, 201);
});

test('Netlify redeploy invalidates old sessions while preserving production leads', async t => {
  const app = await fixture(t);
  const response = await app.json('/api/enquiries', enquiry);
  assert.equal(response.status, 201);
  const created = await response.json();
  const oldCookie = await signIn(app);
  const redeployed = await app.instance({ sessionNamespace: 'new-deploy' });
  assert.equal((await redeployed.request('/api/crm/session', { headers: { Cookie: oldCookie } })).status, 401);
  assert.equal((await redeployed.request('/api/leads', { headers: { Cookie: oldCookie } })).status, 401);
  assert.match(await (await redeployed.request('/CRM/112026', { headers: { Cookie: oldCookie } })).text(), /CRM SIGN-IN/);
  const newCookie = await signIn(redeployed);
  const leads = await (await redeployed.request('/api/leads', { headers: { Cookie: newCookie } })).json();
  assert.deepEqual(leads.leads.map(lead => lead.id), [created.lead.id]);
  assert.equal((await app.request('/api/leads', { headers: { Cookie: newCookie } })).status, 401);
});

test('Netlify preview namespaces isolate leads and sessions from production', async t => {
  const production = await fixture(t);
  assert.equal((await production.json('/api/enquiries', enquiry)).status, 201);
  const productionCookie = await signIn(production);
  const preview = await production.instance({ namespace: 'preview-fixture' });
  assert.equal((await preview.request('/api/leads', { headers: { Cookie: productionCookie } })).status, 401);
  const previewCookie = await signIn(preview);
  const empty = await (await preview.request('/api/leads', { headers: { Cookie: previewCookie } })).json();
  assert.deepEqual(empty.leads, []);
  assert.equal((await preview.json('/api/enquiries', { ...enquiry, name: 'Preview Only Visitor' })).status, 201);
  const previewLeads = await (await preview.request('/api/leads', { headers: { Cookie: previewCookie } })).json();
  assert.deepEqual(previewLeads.leads.map(lead => lead.name), ['Preview Only Visitor']);
  const productionLeads = await (await production.request('/api/leads', { headers: { Cookie: productionCookie } })).json();
  assert.deepEqual(productionLeads.leads.map(lead => lead.name), [enquiry.name]);
  assert.equal((await production.request('/api/leads', { headers: { Cookie: previewCookie } })).status, 401);
});

test('Netlify login rate limiting uses trusted context IP instead of forwarded headers', async t => {
  const app = await fixture(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await app.login('Wrong-Fixture-Password', {
      'X-Forwarded-For': `198.51.100.${attempt + 1}`,
      'X-Nf-Client-Connection-Ip': `203.0.113.${attempt + 1}`,
    });
    assert.equal(response.status, 401);
  }
  const fresh = await app.instance();
  const blocked = await fresh.login(PASSWORD, { 'X-Forwarded-For': '198.51.100.200' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(blocked.headers.get('set-cookie'), null);
  const separateVisitor = await fresh.request('/api/crm/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE, 'X-Forwarded-For': '192.0.2.25' },
    body: JSON.stringify({ password: PASSWORD }),
  }, { ip: '192.0.2.26' });
  assert.equal(separateVisitor.status, 200);
});

test('Netlify rejects oversized buffered and chunked request bodies before saving enquiries', async t => {
  const app = await fixture(t);
  const large = await app.request('/api/enquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '1', Origin: SITE },
    body: JSON.stringify({ ...enquiry, message: 'x'.repeat(33000) }),
  });
  assert.equal(large.status, 413);
  assert.match(large.headers.get('cache-control'), /no-store/);
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8192)); },
    cancel() { cancelled = true; },
  });
  const chunked = await app.request('/api/enquiries', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE }, body, duplex: 'half',
  });
  assert.equal(chunked.status, 413);
  assert.equal(cancelled, true);
  const cookie = await signIn(app);
  const records = await (await app.request('/api/leads', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(records.leads, []);
});

test('Netlify emulator local data persists across handlers without calling Blobs', async t => {
  const app = await fixture(t);
  let blobCalls = 0;
  const unexpectedBlobCall = () => { blobCalls++; throw new Error('Local emulator must use fixture files.'); };
  const localDataDir = path.join(app.directory, 'local-data');
  const localOptions = {
    localDataDir, namespace: 'local-fixture', sessionNamespace: 'fixture-deploy',
    blobStore: { getWithMetadata: unexpectedBlobCall, setJSON: unexpectedBlobCall },
  };
  const local = await app.instance(localOptions);
  const cookie = await signIn(local);
  const submitted = await local.json('/api/enquiries', enquiry);
  assert.equal(submitted.status, 201);
  const created = await submitted.json();
  const recreated = await app.instance(localOptions);
  assert.equal((await recreated.request('/api/crm/session', { headers: { Cookie: cookie } })).status, 200);
  const records = await (await recreated.request('/api/leads', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(records.leads.map(lead => lead.id), [created.lead.id]);
  const savedLeads = JSON.parse(await readFile(path.join(localDataDir, 'local-fixture', 'leads.json'), 'utf8'));
  assert.deepEqual(savedLeads.leads.map(lead => lead.id), [created.lead.id]);
  const savedAuthText = await readFile(path.join(localDataDir, 'local-fixture', 'auth', 'fixture-deploy.json'), 'utf8');
  assert.equal(Object.keys(JSON.parse(savedAuthText).sessions).length, 1);
  assert.equal(savedAuthText.includes(PASSWORD), false);
  assert.equal(savedAuthText.includes(cookie.split('=')[1]), false);
  assert.equal(blobCalls, 0);
});
