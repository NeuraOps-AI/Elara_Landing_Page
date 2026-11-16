import { randomBytes, createHash, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const scrypt = promisify(deriveKey);
const COOKIE = 'elara_crm_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
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
  let saved;
  try { saved = JSON.parse(await readFile(filename, 'utf8')); }
  catch (cause) { if (cause.code === 'ENOENT') return null; throw new Error('Cannot read the local CRM password configuration.'); }
  if (saved.version !== 1 || saved.algorithm !== 'scrypt'
      || !/^[a-f0-9]{64}$/.test(saved.salt || '') || !/^[a-f0-9]{128}$/.test(saved.hash || '')) {
    throw new Error('The local CRM password configuration is invalid.');
  }
  return saved;
}

export async function createCrmAuth({ password, credentialFile, now = Date.now }) {
  const credential = password === undefined ? await readCredential(credentialFile) : await hashCrmPassword(password);
  const sessions = new Map();
  const attempts = new Map();

  function prune() {
    const time = now();
    for (const [key, expiry] of sessions) if (expiry <= time) sessions.delete(key);
    for (const [key, entry] of attempts) if (entry.resetAt <= time) attempts.delete(key);
  }
  function tokenFrom(req) {
    const cookies = (req.headers.cookie || '').split(';').map(value => value.trim())
      .filter(value => value.startsWith(`${COOKIE}=`));
    if (cookies.length !== 1) return '';
    const token = cookies[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
  }
  function authenticated(req) {
    prune();
    const token = tokenFrom(req);
    return Boolean(token && sessions.has(digest(token)));
  }
  function cookie(req, token = '') {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_MS / 1000 : 0}${req.socket.encrypted ? '; Secure' : ''}`;
  }

  return {
    configured: Boolean(credential),
    authenticated,
    sessionInfo(req) {
      if (!authenticated(req)) throw authError(401, 'Please sign in to the CRM.');
      return { authenticated: true, expiresAt: new Date(sessions.get(digest(tokenFrom(req)))).toISOString() };
    },
    require(req) {
      if (!authenticated(req)) throw authError(401, 'Please sign in to the CRM.');
    },
    async login(req, password) {
      if (!credential) throw authError(503, 'CRM sign-in has not been configured. Please contact the site administrator.');
      prune();
      const key = req.socket.remoteAddress || 'local';
      const entry = attempts.get(key) || { count: 0, resetAt: now() + ATTEMPT_WINDOW_MS };
      if (entry.count >= 5) {
        throw authError(429, 'Too many sign-in attempts. Please try again in 15 minutes.', {
          retryAfter: Math.max(1, Math.ceil((entry.resetAt - now()) / 1000)),
        });
      }
      // Count before the asynchronous hash so simultaneous attempts are limited.
      entry.count++;
      attempts.set(key, entry);
      if (typeof password !== 'string' || password.length > 256 || !password.length) {
        throw authError(401, 'That password is not correct. Please try again.');
      }
      const candidate = await scrypt(password, credential.salt, 64);
      if (!timingSafeEqual(candidate, Buffer.from(credential.hash, 'hex'))) {
        throw authError(401, 'That password is not correct. Please try again.');
      }
      attempts.delete(key);
      const previous = tokenFrom(req);
      if (previous) sessions.delete(digest(previous));
      while (sessions.size >= 64) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('base64url');
      sessions.set(digest(token), now() + SESSION_MS);
      return cookie(req, token);
    },
    logout(req) {
      const token = tokenFrom(req);
      if (token) sessions.delete(digest(token));
      return cookie(req);
    },
  };
}
