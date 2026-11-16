import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createNetlifyHandler } from '../../netlify-app.mjs';

const handlers = new Map();

export default async function handler(request, context) {
  try {
    // A previous production deploy must not retain access to live lead data
    // after a password change is deployed on the current production version.
    if (context.deploy.context === 'production' && !context.deploy.published) {
      return Response.json({ error: 'This deployment has been replaced. Please open the current ELARA website.' }, {
        status: 410, headers: { 'Cache-Control': 'no-store' },
      });
    }
    const url = new URL(request.url);
    const origin = url.origin;
    // Netlify's local Blobs emulator currently omits read ETags. Use explicit
    // local persistence there; production must never fall back from CAS writes.
    const localDataDir = process.env.NETLIFY_DEV === 'true'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ? path.join(process.cwd(), '.netlify', 'elara-dev') : undefined;
    // Preview and branch deployments must not read or change production leads.
    const namespace = context.deploy.context === 'production' ? 'production'
      : `preview-${createHash('sha256').update(origin).digest('hex').slice(0, 24)}`;
    const sessionNamespace = context.deploy.id;
    const cacheKey = `${origin}/${namespace}/${sessionNamespace}`;
    if (!handlers.has(cacheKey)) {
      const pending = createNetlifyHandler({
        blobStore: localDataDir ? undefined : getStore({ name: 'elara-crm', consistency: 'strong' }),
        localDataDir,
        crmPassword: process.env.CRM_PASSWORD,
        publicDir: path.join(process.cwd(), 'public'),
        documentsDir: path.join(process.cwd(), 'private'),
        siteOrigin: origin, namespace, sessionNamespace,
      });
      handlers.set(cacheKey, pending);
      pending.catch(() => handlers.delete(cacheKey));
    }
    return await (await handlers.get(cacheKey))(request, context);
  } catch {
    // Do not expose storage details or runtime credentials in a public error.
    return Response.json({ error: 'The service is temporarily unavailable. Please try again shortly.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
    });
  }
}

// Static assets stay on the CDN. The function handles every dynamic or missing
// route, including /CRM/112026, /api/* and wrong URLs that redirect home.
export const config = { path: '/*', preferStatic: true };
