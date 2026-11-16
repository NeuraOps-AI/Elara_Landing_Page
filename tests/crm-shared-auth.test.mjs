import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrmAuth, hashCrmPassword } from '../crm-auth.mjs';

const PASSWORD = 'Serverless-Auth-Test!42';
const SESSION_MS = 8 * 60 * 60 * 1000;

// Represents one durable backing store accessed by separate function instances.
function sharedStore(initialValue = { sessions: {}, attempts: {} }) {
  let value = structuredClone(initialValue);
  let writes = Promise.resolve();
  return {
    async read() { await writes; return structuredClone(value); },
    transaction(change) {
      const next = writes.then(() => {
        const copy = structuredClone(value);
        const result = change(copy);
        value = copy;
        return result;
      });
      writes = next.catch(() => {});
      return next;
    },
  };
}

const request = (cookie = '', address = '203.0.113.7') => ({
  headers: { cookie }, socket: { remoteAddress: address, encrypted: false },
});
const cookieFrom = header => header.split(';')[0];

test('shared CRM sessions survive another function instance and logout revokes them everywhere', async () => {
  const stateStore = sharedStore();
  const config = { password: PASSWORD, stateStore, secureCookies: true };
  const first = await createCrmAuth(config);
  const cookieHeader = await first.login(request(), PASSWORD);
  assert.match(cookieHeader, /; Secure(?:;|$)/);
  assert.match(cookieHeader, /; HttpOnly(?:;|$)/);
  assert.match(cookieHeader, /; SameSite=Strict(?:;|$)/);
  const cookie = cookieFrom(cookieHeader);
  const second = await createCrmAuth(config);
  assert.equal(await second.authenticated(request(cookie)), true);
  assert.equal((await second.sessionInfo(request(cookie))).authenticated, true);
  await second.require(request(cookie));
  assert.match(await second.logout(request(cookie)), /Max-Age=0/);
  assert.equal(await first.authenticated(request(cookie)), false);
  await assert.rejects(first.require(request(cookie)), { status: 401 });
  await assert.rejects(second.sessionInfo(request(cookie)), { status: 401 });
  const stored = JSON.stringify(await stateStore.read());
  assert.equal(stored.includes(PASSWORD), false);
  assert.equal(stored.includes(cookie.split('=')[1]), false);
  assert.equal(stored.includes('203.0.113.7'), false);
});

test('repeated concurrent failures share one sign-in limit across function instances', async () => {
  const stateStore = sharedStore();
  let now = Date.UTC(2026, 10, 16, 6);
  const config = { password: PASSWORD, stateStore, now: () => now };
  const instances = await Promise.all([createCrmAuth(config), createCrmAuth(config)]);
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    instances[index % 2].login(request(), 'Wrong-Test-Password!')));
  assert.equal(results.filter(result => result.reason?.status === 401).length, 5);
  assert.equal(results.filter(result => result.reason?.status === 429).length, 3);
  await assert.rejects(instances[1].login(request(), PASSWORD), error => error.status === 429 && error.retryAfter === 900);
  const freshInstance = await createCrmAuth(config);
  await assert.rejects(freshInstance.login(request(), PASSWORD), { status: 429 });
  const otherAddress = await freshInstance.login(request('', '203.0.113.8'), PASSWORD);
  assert.equal(await freshInstance.authenticated(request(cookieFrom(otherAddress))), true);
  now += 15 * 60 * 1000;
  assert.match(await freshInstance.login(request(), PASSWORD), /^elara_crm_session=/);
});

test('shared sessions expire on time and a new login revokes the supplied old session', async () => {
  const stateStore = sharedStore();
  let now = Date.UTC(2026, 10, 16, 6);
  const config = { password: PASSWORD, stateStore, now: () => now };
  const first = await createCrmAuth(config);
  const second = await createCrmAuth(config);
  const oldCookie = cookieFrom(await first.login(request(), PASSWORD));
  const newCookie = cookieFrom(await second.login(request(oldCookie), PASSWORD));
  assert.notEqual(oldCookie, newCookie);
  assert.equal(await first.authenticated(request(oldCookie)), false);
  assert.deepEqual(await first.sessionInfo(request(newCookie)), {
    authenticated: true, expiresAt: new Date(now + SESSION_MS).toISOString(),
  });
  now += SESSION_MS - 1;
  assert.equal(await first.authenticated(request(newCookie)), true);
  now++;
  assert.equal(await second.authenticated(request(newCookie)), false);
});

test('missing or invalid credentials and corrupted shared state never unlock CRM', async () => {
  const stateStore = sharedStore();
  const configured = await createCrmAuth({ password: PASSWORD, stateStore });
  const cookie = cookieFrom(await configured.login(request(), PASSWORD));
  const missing = await createCrmAuth({ credentialFile: null, stateStore });
  assert.equal(missing.configured, false);
  assert.equal(await missing.authenticated(request(cookie)), false);
  await assert.rejects(missing.login(request(), PASSWORD), { status: 503 });
  for (const credential of [null, [], 'invalid', { version: 1 }]) {
    await assert.rejects(createCrmAuth({ credential }), /CRM password configuration is invalid/);
  }
  const corrupt = await createCrmAuth({ password: PASSWORD, stateStore: sharedStore({ sessions: [], attempts: {} }) });
  await assert.rejects(corrupt.authenticated(request(cookie)), { status: 503 });
  await assert.rejects(corrupt.login(request(), PASSWORD), { status: 503 });
});

test('a prehashed configured credential verifies passwords without requiring a credential file', async () => {
  const credential = await hashCrmPassword(PASSWORD);
  const auth = await createCrmAuth({ credential });
  const cookie = cookieFrom(await auth.login(request(), PASSWORD));
  assert.equal(await auth.authenticated(request(cookie)), true);
  await assert.rejects(auth.login(request('', '203.0.113.9'), 'Wrong-Test-Password!'), { status: 401 });
});

test('storage failures do not create a session or return a successful logout', async () => {
  const stateStore = sharedStore();
  const auth = await createCrmAuth({ password: PASSWORD, stateStore });
  const cookie = cookieFrom(await auth.login(request(), PASSWORD));
  const unavailable = Object.assign(new Error('Storage unavailable'), { status: 503 });
  stateStore.transaction = async () => { throw unavailable; };
  await assert.rejects(auth.login(request(), PASSWORD), { status: 503 });
  await assert.rejects(auth.logout(request(cookie)), { status: 503 });
});
