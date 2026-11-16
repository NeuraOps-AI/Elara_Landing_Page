import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { createElaraServer } from '../server.mjs';
import { hashCrmPassword } from '../crm-auth.mjs';

const TEST_PASSWORD = 'Only-For-Tests!42';
const CRM_PATH = '/CRM/112026';
const COOKIE_NAME = 'elara_crm_session';
const validEnquiry = {
  name: 'Auth Test Visitor', email: 'auth-visitor@example.com', phone: '+91 98765 43210',
  interest: 'Private visit', message: '', source: 'Authentication test', document: 'brochure', consent: true,
};

async function fixture(t, { configured = true, storedCredential } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'elara-auth-test-'));
  let now = Date.UTC(2026, 10, 16, 6);
  const config = {
    publicDir: path.join(directory, 'public'),
    dataDir: path.join(directory, 'data'),
    documentsDir: path.join(directory, 'private'),
    ...(configured ? { crmPassword: TEST_PASSWORD } : {}),
    authNow: () => now,
  };
  await Promise.all([mkdir(config.publicDir), mkdir(config.documentsDir)]);
  await Promise.all([
    writeFile(path.join(config.publicDir, 'index.html'), '<h1>Public ELARA website</h1>'),
    writeFile(path.join(config.publicDir, 'crm-login.html'), '<h1>CRM SIGN-IN</h1><input type="password">'),
    writeFile(path.join(config.publicDir, 'crm.html'), '<h1>PRIVATE-DASHBOARD</h1>'),
    writeFile(path.join(config.documentsDir, 'ELARA-Brochure.pdf'), '%PDF-1.4\nAuth fixture brochure\n%%EOF'),
  ]);
  const credentialFile = path.join(config.dataDir, 'crm-auth.json');
  if (storedCredential !== undefined) {
    await mkdir(config.dataDir);
    await writeFile(credentialFile, storedCredential);
  }
  let server;
  let base;
  async function start() {
    // Fixture auth must never inherit a developer's real password setting.
    const previous = process.env.CRM_PASSWORD;
    delete process.env.CRM_PASSWORD;
    try { server = await createElaraServer(config); }
    finally {
      if (previous !== undefined) process.env.CRM_PASSWORD = previous;
    }
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
  t.after(async () => {
    await close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  await start();
  const request = (pathname, options = {}) => fetch(base + pathname, options);
  const json = (pathname, body, headers = {}) => request(pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return {
    request, json,
    login: (password = TEST_PASSWORD, headers = {}) => json('/api/crm/login', { password }, headers),
    base: () => base,
    now: () => now,
    credential: () => readFile(credentialFile, 'utf8'),
    advance: milliseconds => { now += milliseconds; },
    restart: async () => { await close(); await start(); },
  };
}

async function authenticatedCookie(app) {
  const response = await app.login();
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('CRM shows only the password screen until sign-in and redirects direct dashboard aliases home', async t => {
  const app = await fixture(t);
  const response = await app.request(CRM_PATH);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /CRM SIGN-IN/);
  assert.doesNotMatch(html, /PRIVATE-DASHBOARD/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const head = await app.request(CRM_PATH, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  for (const alias of ['/crm', '/crm/', '/CRM', '/crm.html', '/CRM.HTML', '/crm.html/', '/%63rm.html', '/%63rm%2ehtml']) {
    const blocked = await app.request(alias, { redirect: 'manual' });
    assert.equal(blocked.status, 302, alias);
    assert.equal(blocked.headers.get('location'), '/', alias);
    assert.match(blocked.headers.get('cache-control'), /no-store/, alias);
    assert.doesNotMatch(await blocked.text(), /PRIVATE-DASHBOARD/, alias);
  }
  const cookie = await authenticatedCookie(app);
  const dashboard = await app.request(CRM_PATH, { headers: { Cookie: cookie } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /PRIVATE-DASHBOARD/);
  assert.match(dashboard.headers.get('cache-control'), /private/);
  assert.match(dashboard.headers.get('cache-control'), /no-store/);
  const directDashboard = await app.request('/crm.html', { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(directDashboard.status, 302);
  assert.equal(directDashboard.headers.get('location'), '/');
  assert.doesNotMatch(await directDashboard.text(), /PRIVATE-DASHBOARD/);
});

test('wrong page URLs redirect to the landing page without revealing the CRM', async t => {
  const app = await fixture(t);
  for (const pathname of ['/not-a-page', '/missing.html', '/CRM/112025?next=https://foreign.example', '/CRM/112026/extra']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await app.request(pathname, { method, redirect: 'manual' });
      assert.equal(response.status, 302, `${method} ${pathname}`);
      assert.equal(response.headers.get('location'), '/');
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.equal(await response.text(), '');
    }
  }
  const followed = await app.request('/CRM/incorrect');
  assert.equal(followed.url, `${app.base()}/`);
  assert.equal(followed.status, 200);
  assert.match(await followed.text(), /Public ELARA website/);
  const browserDocument = await app.request('/private/ELARA-Brochure.pdf', {
    redirect: 'manual', headers: { Accept: 'text/html,application/xhtml+xml', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' },
  });
  assert.equal(browserDocument.status, 302);
  assert.equal(browserDocument.headers.get('location'), '/');
  assert.doesNotMatch(await browserDocument.text(), /Auth fixture brochure/);
});

test('page redirects do not hide API errors, missing assets or invalid submission methods', async t => {
  const app = await fixture(t);
  const unknownApi = await app.request('/api/not-an-endpoint', { redirect: 'manual', headers: { Accept: 'text/html' } });
  assert.equal(unknownApi.status, 404);
  assert.equal(unknownApi.headers.get('location'), null);
  assert.match(unknownApi.headers.get('content-type'), /application\/json/);
  const lockedApi = await app.request('/api/leads', { redirect: 'manual', headers: { Accept: 'text/html' } });
  assert.equal(lockedApi.status, 401);
  assert.equal(lockedApi.headers.get('location'), null);
  const missingAsset = await app.request('/assets/missing.js', {
    redirect: 'manual', headers: { Accept: '*/*', 'Sec-Fetch-Dest': 'script' },
  });
  assert.equal(missingAsset.status, 404);
  assert.equal(missingAsset.headers.get('location'), null);
  const wrongPost = await app.request('/not-a-page', { method: 'POST', redirect: 'manual' });
  assert.equal(wrongPost.status, 405);
  assert.equal(wrongPost.headers.get('location'), null);
});

test('anonymous and forged requests cannot read, export or change leads', async t => {
  const app = await fixture(t);
  const attempts = [
    ['/api/leads', {}],
    ['/api/leads/export', {}],
    ['/api/leads/00000000-0000-0000-0000-000000000000', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Closed' }) }],
  ];
  for (const [pathname, options] of attempts) {
    for (const cookie of ['', `${COOKIE_NAME}=${'a'.repeat(43)}`, `${COOKIE_NAME}=malformed`]) {
      const response = await app.request(pathname, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) } });
      assert.equal(response.status, 401, `${pathname}, cookie: ${cookie ? 'forged' : 'absent'}`);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const body = await response.json();
      assert.equal(Object.hasOwn(body, 'leads'), false);
    }
  }
  assert.equal((await app.request(`/api/leads?password=${encodeURIComponent(TEST_PASSWORD)}`)).status, 401);
  assert.equal((await app.request('/api/crm/session')).status, 401);
});

test('password verification sets an opaque HttpOnly session and does not echo credentials', async t => {
  const app = await fixture(t);
  const wrong = await app.login('Incorrect-Test-Password');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  const response = await app.login(TEST_PASSWORD, { Origin: app.base() });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /^elara_crm_session=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
  assert.match(setCookie, /(?:^|;)\s*SameSite=Strict(?:;|$)/i);
  assert.match(setCookie, /(?:^|;)\s*Path=\/(?:;|$)/i);
  assert.match(setCookie, /(?:^|;)\s*Max-Age=28800(?:;|$)/i);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { ok: true });
  assert.equal(body.includes(TEST_PASSWORD), false);
  assert.equal(setCookie.includes(TEST_PASSWORD), false);
  const cookie = setCookie.split(';')[0];
  const session = await app.request('/api/crm/session', { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { authenticated: true, expiresAt: new Date(app.now() + 8 * 60 * 60 * 1000).toISOString() });
  assert.deepEqual((await (await app.request('/api/leads', { headers: { Cookie: cookie } })).json()).leads, []);
});

test('logout invalidates the server session and clears the browser cookie', async t => {
  const app = await fixture(t);
  const cookie = await authenticatedCookie(app);
  const response = await app.request('/api/crm/logout', { method: 'POST', headers: { Cookie: cookie, Origin: app.base() } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal((await app.request('/api/crm/session', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await app.request('/api/leads', { headers: { Cookie: cookie } })).status, 401);
  assert.match(await (await app.request(CRM_PATH, { headers: { Cookie: cookie } })).text(), /CRM SIGN-IN/);
  assert.equal((await app.request('/api/crm/logout', { method: 'POST' })).status, 200);
});

test('sessions expire after eight hours and are invalidated by a server restart', async t => {
  const app = await fixture(t);
  const cookie = await authenticatedCookie(app);
  app.advance(8 * 60 * 60 * 1000 - 1);
  assert.equal((await app.request('/api/crm/session', { headers: { Cookie: cookie } })).status, 200);
  app.advance(1);
  assert.equal((await app.request('/api/crm/session', { headers: { Cookie: cookie } })).status, 401);
  const newCookie = await authenticatedCookie(app);
  await app.restart();
  assert.equal((await app.request('/api/leads', { headers: { Cookie: newCookie } })).status, 401);
  assert.equal((await app.login()).status, 200);
});

test('repeated failed passwords are limited without preventing login after the cooldown', async t => {
  const app = await fixture(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await app.login('Incorrect-Test-Password')).status, 401);
  }
  const blocked = await app.login();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(blocked.headers.get('set-cookie'), null);
  app.advance(15 * 60 * 1000 + 1);
  assert.equal((await app.login()).status, 200);
});

test('login and logout reject cross-origin requests and do not log out an existing session', async t => {
  const app = await fixture(t);
  assert.equal((await app.login(TEST_PASSWORD, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await app.login(TEST_PASSWORD, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const request = http.request(app.base() + '/api/crm/login', { method: 'POST', headers: { Host: 'foreign.example', 'Content-Type': 'application/json' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject);
    request.end(JSON.stringify({ password: TEST_PASSWORD }));
  });
  assert.equal(foreignHost, 403);
  const cookie = await authenticatedCookie(app);
  assert.equal((await app.request('/api/crm/logout', { method: 'POST', headers: { Origin: 'https://foreign.example', Cookie: cookie } })).status, 403);
  assert.equal((await app.request('/api/crm/session', { headers: { Cookie: cookie } })).status, 200);
});

test('missing CRM password fails closed while public enquiries and downloads still work', async t => {
  const app = await fixture(t, { configured: false });
  assert.equal((await app.request('/')).status, 200);
  assert.match(await (await app.request(CRM_PATH)).text(), /CRM SIGN-IN/);
  assert.equal((await app.login()).status, 503);
  assert.equal((await app.request('/api/leads')).status, 401);
  const enquiry = await app.json('/api/enquiries', validEnquiry);
  assert.equal(enquiry.status, 201);
  const { downloads } = await enquiry.json();
  const download = await app.request(downloads[0].url);
  assert.equal(download.status, 200);
  assert.match(await download.text(), /^%PDF/);
});

test('stored password hashes authenticate after restart without retaining plaintext', async t => {
  const hashed = await hashCrmPassword(TEST_PASSWORD);
  const app = await fixture(t, { configured: false, storedCredential: JSON.stringify(hashed) });
  const saved = await app.credential();
  assert.equal(saved.includes(TEST_PASSWORD), false);
  assert.equal(Object.hasOwn(JSON.parse(saved), 'password'), false);
  const cookie = await authenticatedCookie(app);
  assert.equal((await app.request('/api/leads', { headers: { Cookie: cookie } })).status, 200);
  await app.restart();
  assert.equal((await app.request('/api/leads', { headers: { Cookie: cookie } })).status, 401);
  const newCookie = await authenticatedCookie(app);
  assert.equal((await app.request('/api/leads', { headers: { Cookie: newCookie } })).status, 200);
  assert.equal(await app.credential(), saved);
});

test('corrupt password configuration refuses to start instead of opening the CRM', async t => {
  await t.test('invalid JSON', async t => {
    await assert.rejects(fixture(t, { configured: false, storedCredential: '{invalid-json' }), /CRM password configuration/);
  });
  await t.test('invalid credential shape', async t => {
    await assert.rejects(fixture(t, { configured: false, storedCredential: JSON.stringify({ version: 1, algorithm: 'scrypt', salt: 'invalid', hash: 'invalid' }) }), /CRM password configuration/);
  });
});
