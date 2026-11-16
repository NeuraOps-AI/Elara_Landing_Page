import serverless from 'serverless-http';
import path from 'node:path';
import { createElaraHandler } from './server.mjs';
import { createBlobStore, createFileStore } from './storage.mjs';

const BODY_LIMIT = 32 * 1024;

// Keep the same tested application routes on localhost and on Netlify.
// The adapter never starts a listening server or writes to the function filesystem.
export async function createNetlifyHandler({
  blobStore, crmPassword, publicDir, documentsDir, localDataDir,
  siteOrigin = 'https://elaravillas.com', namespace = 'production', sessionNamespace = 'current',
}) {
  const createStore = (key, initial, options) => localDataDir
    ? createFileStore(path.join(localDataDir, `${key}.json`), initial, options)
    : createBlobStore(blobStore, key, initial, options);
  const databaseStore = await createStore(`${namespace}/leads`, { version: 1, leads: [], grants: [] }, {
    validate(value) {
      if (value?.version !== 1 || !Array.isArray(value.leads) || !Array.isArray(value.grants)) {
        throw new Error('The leads store is invalid. Existing data has been preserved.');
      }
    },
  });
  const authStore = await createStore(`${namespace}/auth/${sessionNamespace}`, { sessions: {}, attempts: {} });
  const app = await createElaraHandler({
    databaseStore, authStore, crmPassword, publicDir, documentsDir, dataDir: null,
    siteOrigin, storageName: localDataDir ? 'netlify-dev-local' : 'netlify-blobs',
  });
  const invoke = serverless(app, {
    binary: ['application/pdf', 'application/zip'],
    request(req, event) {
      // Netlify's verified context.ip is passed here, never X-Forwarded-For.
      Object.defineProperty(req.socket, 'remoteAddress', { value: event.requestContext.identity.sourceIp, configurable: true });
      req.socket.encrypted = siteOrigin.startsWith('https://');
    },
  });

  return async (request, context = {}) => {
    const url = new URL(request.url);
    if (url.origin !== siteOrigin) {
      return Response.json({ error: 'Please use the ELARA website address.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    // Bound streamed/chunked bodies too; do not buffer an unlimited form first.
    const chunks = [];
    let size = 0;
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > BODY_LIMIT) {
            await reader.cancel();
            return Response.json({ error: 'The form is too large.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
          }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
    }
    const headers = Object.fromEntries(request.headers);
    headers.host = url.host;
    headers['content-length'] = String(size);
    const result = await invoke({
      httpMethod: request.method, path: url.pathname, rawUrl: request.url,
      headers, multiValueQueryStringParameters: Object.fromEntries(
        [...new Set(url.searchParams.keys())].map(key => [key, url.searchParams.getAll(key)]),
      ),
      body: Buffer.concat(chunks).toString('base64'), isBase64Encoded: true,
      requestContext: { identity: { sourceIp: context.ip || 'unknown' } },
    }, {});
    const responseHeaders = new Headers(result.headers);
    for (const [key, values] of Object.entries(result.multiValueHeaders || {})) {
      responseHeaders.delete(key);
      for (const value of values) responseHeaders.append(key, value);
    }
    const body = request.method === 'HEAD' || [204, 304].includes(result.statusCode) ? null
      : Buffer.from(result.body || '', result.isBase64Encoded ? 'base64' : 'utf8');
    return new Response(body, { status: result.statusCode, headers: responseHeaders });
  };
}
