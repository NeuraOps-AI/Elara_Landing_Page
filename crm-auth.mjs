import { randomBytes, createHash, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const scrypt = promisify(deriveKey);
const COOKIE = 'elara_crm_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPT_ADDRESSES = 4096;
const digest = token => createHash('sha256').update(token).digest('hex');
const authError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export async function hashCrmPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new Error('The CRM password must contain 12–256 characters.');
  }
  const salt = randomBytes(32).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { version: 1, algorithm: 'scrypt', salt, hash: hash.toString('hex') };
}

async function readCredential(filename) {
  if (!filename) return null;
  let saved;
  try { saved = JSON.parse(await readFile(filename, 'utf8')); }
  catch (cause) { if (cause.code === 'ENOENT') return null; throw new Error('Cannot read the local CRM password configuration.'); }
  return validateCredential(saved);
}

function validateCredential(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)
      || saved.version !== 1 || saved.algorithm !== 'scrypt'
      || typeof saved.salt !== 'string' || !/^[a-f0-9]{64}$/.test(saved.salt)
      || typeof saved.hash !== 'string' || !/^[a-f0-9]{128}$/.test(saved.hash)) {
    throw new Error('The local CRM password configuration is invalid.');
  }
  return saved;
}

function memoryStore() {
  let value = { sessions: {}, attempts: {} };
  let writes = Promise.resolve();
  return {
    async read() { await writes; return structuredClone(value); },
    transaction(change) {
      const operation = writes.then(() => {
        const next = structuredClone(value);
        const result = change(next);
        value = next;
        return result;
      });
      writes = operation.catch(() => {});
      return operation;
    },
  };
}

export async function createCrmAuth({
  password, credentialFile, credential: suppliedCredential, now = Date.now,
  stateStore = memoryStore(), secureCookies = false,
}) {
  const credential = password !== undefined ? await hashCrmPassword(password)
    : suppliedCredential !== undefined ? validateCredential(suppliedCredential)
      : await readCredential(credentialFile);

  function validateState(state) {
    const dictionary = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!dictionary(state) || !dictionary(state.sessions) || !dictionary(state.attempts)
      || Object.entries(state.sessions).some(([key, expiry]) => !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(expiry))
      || Object.entries(state.attempts).some(([key, entry]) => !/^[a-f0-9]{64}$/.test(key)
        || !dictionary(entry) || !Number.isSafeInteger(entry.count) || entry.count < 1
        || !Number.isSafeInteger(entry.resetAt))) {
      throw authError(503, 'CRM sign-in is temporarily unavailable. Please try again later.');
    }
    return state;
  }

  function prune(state) {
    validateState(state);
    const time = now();
    for (const [key, expiry] of Object.entries(state.sessions)) if (expiry <= time) delete state.sessions[key];
    for (const [key, entry] of Object.entries(state.attempts)) if (entry.resetAt <= time) delete state.attempts[key];
  }
  function tokenFrom(req) {
    const cookies = (req.headers.cookie || '').split(';').map(value => value.trim())
      .filter(value => value.startsWith(`${COOKIE}=`));
    if (cookies.length !== 1) return '';
    const token = cookies[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
  }
  async function sessionExpiry(req) {
    if (!credential) return null;
    const token = tokenFrom(req);
    if (!token) return null;
    const state = validateState(await stateStore.read());
    const expiry = state.sessions[digest(token)];
    return expiry > now() ? expiry : null;
  }
  async function authenticated(req) { return (await sessionExpiry(req)) !== null; }
  function cookie(req, token = '') {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_MS / 1000 : 0}${secureCookies || req.socket?.encrypted ? '; Secure' : ''}`;
  }

  return {
    configured: Boolean(credential),
    authenticated,
    async sessionInfo(req) {
      const expiry = await sessionExpiry(req);
      if (expiry === null) throw authError(401, 'Please sign in to the CRM.');
      return { authenticated: true, expiresAt: new Date(expiry).toISOString() };
    },
    async require(req) {
      if (!await authenticated(req)) throw authError(401, 'Please sign in to the CRM.');
    },
    async login(req, password) {
      if (!credential) throw authError(503, 'CRM sign-in has not been configured. Please contact the site administrator.');
      // The adapter supplies a trusted client address, never a forwarded header.
      const key = digest(req.socket?.remoteAddress || 'local');
      // Count atomically before hashing, including across function instances.
      await stateStore.transaction(state => {
        prune(state);
        const entry = state.attempts[key] || { count: 0, resetAt: now() + ATTEMPT_WINDOW_MS };
        if (entry.count >= 5 || (!state.attempts[key] && Object.keys(state.attempts).length >= MAX_ATTEMPT_ADDRESSES)) {
          throw authError(429, 'Too many sign-in attempts. Please try again in 15 minutes.', {
            retryAfter: Math.max(1, Math.ceil((entry.resetAt - now()) / 1000)),
          });
        }
        entry.count++;
        state.attempts[key] = entry;
      });
      if (typeof password !== 'string' || password.length > 256 || !password.length) {
        throw authError(401, 'That password is not correct. Please try again.');
      }
      const candidate = await scrypt(password, credential.salt, 64);
      if (!timingSafeEqual(candidate, Buffer.from(credential.hash, 'hex'))) {
        throw authError(401, 'That password is not correct. Please try again.');
      }
      const previous = tokenFrom(req);
      const token = randomBytes(32).toString('base64url');
      await stateStore.transaction(state => {
        prune(state);
        delete state.attempts[key];
        if (previous) delete state.sessions[digest(previous)];
        const oldest = Object.keys(state.sessions).sort((a, b) => state.sessions[a] - state.sessions[b]);
        while (oldest.length >= 64) delete state.sessions[oldest.shift()];
        state.sessions[digest(token)] = now() + SESSION_MS;
      });
      return cookie(req, token);
    },
    async logout(req) {
      const token = tokenFrom(req);
      if (token) await stateStore.transaction(state => {
        prune(state);
        delete state.sessions[digest(token)];
      });
      return cookie(req);
    },
  };
}
