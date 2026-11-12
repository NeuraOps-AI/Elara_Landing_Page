import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = 32 * 1024;
const GRANT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const STATUSES = ['New', 'Contacted', 'Qualified', 'Site visit', 'Closed', 'Lost'];
const DOCUMENTS = {
  brochure: { file: 'ELARA-Brochure.pdf', name: 'ELARA Brochure' },
  'price-sheet': { file: 'ELARA-Price-Sheet.pdf', name: 'ELARA Price Sheet' },
  both: { file: 'ELARA-Project-Details.zip', name: 'ELARA Project Details' },
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function error(status, message, fields) {
  return Object.assign(new Error(message), { status, fields });
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw error(415, 'Send the form as JSON.');
  }
  if (Number(req.headers['content-length']) > BODY_LIMIT) throw error(413, 'The form is too large.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw error(413, 'The form is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw error(400, 'Enter a valid form.');
  }
}

const text = value => typeof value === 'string' ? value.trim() : '';

function validateEnquiry(input) {
  const fields = {};
  const name = text(input.name);
  const email = text(input.email).toLowerCase();
  const phone = text(input.phone);
  const interest = text(input.interest);
  const message = text(input.message);
  const source = text(input.source) || 'Website enquiry';
  const document = input.document;
  if (name.length < 2 || name.length > 100) fields.name = 'Enter your full name (2–100 characters).';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fields.email = 'Enter a valid email address.';
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(phone) || digits.length < 10 || digits.length > 15 || phone.length > 30) {
    fields.phone = 'Enter a valid phone number with 10–15 digits.';
  }
  if (interest.length > 120) fields.interest = 'Keep the interest below 120 characters.';
  if (message.length > 2000) fields.message = 'Keep your message below 2,000 characters.';
  if (source.length > 120) fields.source = 'Invalid enquiry source.';
  if (!['brochure', 'price-sheet', 'both'].includes(document)) fields.document = 'Select a brochure or price sheet.';
  if (input.consent !== true) fields.consent = 'Please agree to be contacted about your enquiry.';
  if (Object.keys(fields).length) throw error(422, 'Please check the highlighted details.', fields);
  return { name, email, phone, interest, message, source, requestedDocuments: document === 'both' ? ['brochure', 'price-sheet'] : [document] };
}

function checkLocalRequest(req) {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) throw error(403, 'This application is available on localhost only.');
  if (req.headers.origin && req.headers.origin !== `http://${host}`) throw error(403, 'Please submit this request from the ELARA website.');
  if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw error(403, 'Please open the ELARA website directly.');
}

function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }

function csvCell(value) {
  let str = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r\n]/.test(str)) str = `'${str}`;
  return `"${str.replaceAll('"', '""')}"`;
}

// ZIP STORE keeps the original PDFs intact and avoids an external ZIP dependency.
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of files) {
    const filename = Buffer.from(name);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuffer, end]);
}

async function streamFile(req, res, filename, type, headers = {}) {
  let info;
  try { info = await stat(filename); } catch (cause) {
    if (cause.code === 'ENOENT') throw error(404, 'This file is not available yet. Please contact the ELARA team.');
    throw cause;
  }
  if (!info.isFile()) throw error(404, 'File not found.');
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return;
    }
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Number(match[2]); }
    if (start > end || start >= info.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return;
    }
    end = Math.min(end, info.size - 1);
    status = 206;
  }
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': info.size ? end - start + 1 : 0,
    'Accept-Ranges': 'bytes',
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
    ...headers,
  });
  if (req.method === 'HEAD' || !info.size) { res.end(); return; }
  const stream = createReadStream(filename, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

/** Creates a loopback-oriented app. The caller controls the listening port. */
export async function createElaraServer({ publicDir = path.join(ROOT, 'public'), dataDir = path.join(ROOT, 'data'), documentsDir = path.join(ROOT, 'private') } = {}) {
  const dataFile = path.join(dataDir, 'leads.json');
  await mkdir(dataDir, { recursive: true });
  let database = { version: 1, leads: [], grants: [] };
  try {
    const saved = JSON.parse(await readFile(dataFile, 'utf8'));
    if (saved.version !== 1 || !Array.isArray(saved.leads) || !Array.isArray(saved.grants)) throw new Error('Unsupported leads database format.');
    database = saved;
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw new Error(`Cannot read the leads database. Existing data has been preserved: ${cause.message}`);
  }
  let writes = Promise.resolve();
  function transaction(change) {
    const operation = writes.then(async () => {
      const next = structuredClone(database);
      const result = change(next);
      await writeFile(`${dataFile}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(`${dataFile}.tmp`, dataFile);
      database = next;
      return result;
    });
    writes = operation.catch(() => {});
    return operation;
  }

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      checkLocalRequest(req);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = decodeURIComponent(url.pathname);
      const method = req.method;

      if (pathname === '/api/health' && method === 'GET') {
        sendJson(res, 200, { ok: true, app: 'ELARA', storage: 'local', statuses: STATUSES }); return;
      }

      if (pathname === '/api/enquiries' && method === 'POST') {
        const enquiry = validateEnquiry(await readJson(req));
        const result = await transaction(db => {
          const createdAt = new Date().toISOString();
          const lead = { id: randomUUID(), ...enquiry, createdAt, updatedAt: createdAt, status: 'New', notes: '', consent: true };
          db.leads.push(lead);
          db.grants = db.grants.filter(grant => Date.parse(grant.expiresAt) > Date.now());
          const expiresAt = new Date(Date.now() + GRANT_LIFETIME_MS).toISOString();
          const availableDownloads = [...enquiry.requestedDocuments, ...(enquiry.requestedDocuments.length === 2 ? ['both'] : [])];
          const downloads = availableDownloads.map(document => {
            const token = randomBytes(32).toString('base64url');
            db.grants.push({ tokenHash: tokenHash(token), leadId: lead.id, document, expiresAt });
            return { document, name: DOCUMENTS[document].name, url: `/api/downloads/${document}?token=${token}`, expiresAt };
          });
          return { lead, downloads };
        });
        sendJson(res, 201, result); return;
      }

      const downloadMatch = /^\/api\/downloads\/(brochure|price-sheet|both)$/.exec(pathname);
      if (downloadMatch && ['GET', 'HEAD'].includes(method)) {
        const document = downloadMatch[1];
        const token = url.searchParams.get('token') || '';
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw error(403, 'Please complete the enquiry form to unlock this download.');
        const hash = Buffer.from(tokenHash(token), 'hex');
        const grant = database.grants.find(item => item.document === document && Date.parse(item.expiresAt) > Date.now() && timingSafeEqual(Buffer.from(item.tokenHash, 'hex'), hash));
        if (!grant) throw error(403, 'This download link has expired. Please complete the enquiry form again.');
        if (document === 'both') {
          const files = [];
          for (const kind of ['brochure', 'price-sheet']) {
            try {
              files.push({ name: DOCUMENTS[kind].file, data: await readFile(path.join(documentsDir, DOCUMENTS[kind].file)) });
            } catch (cause) {
              if (cause.code === 'ENOENT') throw error(404, 'A project document is not available yet. Please contact the ELARA team.');
              throw cause;
            }
          }
          const zip = makeZip(files);
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="ELARA-Project-Details.zip"', 'Content-Length': zip.length, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
          res.end(method === 'HEAD' ? undefined : zip);
          return;
        }
        await streamFile(req, res, path.join(documentsDir, DOCUMENTS[document].file), 'application/pdf', {
          'Content-Disposition': `attachment; filename="${DOCUMENTS[document].file}"`,
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
        });
        return;
      }

      if (pathname === '/api/leads' && method === 'GET') {
        await writes;
        sendJson(res, 200, { leads: [...database.leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }); return;
      }

      if (pathname === '/api/leads/export' && method === 'GET') {
        await writes;
        const columns = ['Name', 'Email', 'Phone', 'Interest', 'Status', 'Source', 'Requested documents', 'Message', 'Notes', 'Created at', 'Updated at'];
        const rows = database.leads.map(lead => [lead.name, lead.email, lead.phone, lead.interest, lead.status, lead.source, lead.requestedDocuments.join(', '), lead.message, lead.notes, lead.createdAt, lead.updatedAt]);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ELARA-Leads.csv"', 'Cache-Control': 'no-store' });
        res.end('\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')); return;
      }

      const leadMatch = /^\/api\/leads\/([0-9a-f-]{36})$/i.exec(pathname);
      if (leadMatch && method === 'PATCH') {
        const input = await readJson(req);
        if (input.status !== undefined && !STATUSES.includes(input.status)) throw error(422, 'Select a valid lead status.');
        if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 10000)) throw error(422, 'Keep notes below 10,000 characters.');
        if (input.status === undefined && input.notes === undefined) throw error(422, 'Provide a status or notes to update.');
        const lead = await transaction(db => {
          const found = db.leads.find(item => item.id === leadMatch[1]);
          if (!found) throw error(404, 'This lead was not found.');
          if (input.status !== undefined) found.status = input.status;
          if (input.notes !== undefined) found.notes = input.notes.trim();
          found.updatedAt = new Date().toISOString();
          return found;
        });
        sendJson(res, 200, { lead }); return;
      }

      if (pathname.startsWith('/api/')) throw error(404, 'API endpoint not found.');
      if (!['GET', 'HEAD'].includes(method)) throw error(405, 'Method not allowed.');
      const target = pathname === '/' ? 'index.html' : /^\/crm\/?$/.test(pathname) ? 'crm.html' : pathname.slice(1);
      const filename = path.resolve(publicDir, target);
      const relative = path.relative(path.resolve(publicDir), filename);
      if (relative.startsWith('..') || path.isAbsolute(relative) || target.includes('\\') || target.includes('\0') || target.split('/').some(part => part.startsWith('.'))) {
        throw error(404, 'Page not found.');
      }
      const type = TYPES[path.extname(filename).toLowerCase()];
      if (!type) throw error(404, 'Page not found.');
      await streamFile(req, res, filename, type, { 'Cache-Control': ['.html', '.css', '.js', '.mjs'].includes(path.extname(filename)) ? 'no-store' : 'public, max-age=3600' });
    } catch (cause) {
      if (res.headersSent) { res.destroy(); return; }
      if (cause.status) sendJson(res, cause.status, { error: cause.message, ...(cause.fields ? { fields: cause.fields } : {}) });
      else if (cause instanceof URIError) sendJson(res, 400, { error: 'Invalid request URL.' });
      else {
        console.error('ELARA request failed:', cause.message);
        sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
      }
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = await createElaraServer();
  server.on('error', cause => {
    console.error(cause.code === 'EADDRINUSE' ? `Port ${port} is in use. Try another port: $env:PORT=3001; npm start` : cause.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`ELARA website: http://localhost:${port}`);
    console.log(`ELARA leads CRM: http://localhost:${port}/crm`);
    console.log('Local preview only. Leads are stored in data/leads.json.');
  });
}
