import worker from './index.js';
export * from './index.js';

const cookieName = '__Host-rer_preview';
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid grant encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}
async function verifyGrant(token, env) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.RER_PREVIEW_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, decode(parts[1]), new TextEncoder().encode(parts[0]))) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (payload.releaseDigest !== env.RER_RELEASE_DIGEST || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now() || payload.expiresAt > Date.now() + 900_000) return null;
    return payload;
  } catch { return null; }
}
function denied() { return new Response('Preview access required', { status: 401, headers: { 'Cache-Control': 'no-store' } }); }

export default {
  ...worker,
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (env.RER_PREVIEW_TOKEN) {
      const grant = url.searchParams.get('rer_preview_grant');
      if (grant !== null) {
        if (request.method !== 'GET') return denied();
        const payload = await verifyGrant(grant, env);
        if (!payload) return denied();
        url.searchParams.delete('rer_preview_grant');
        const maxAge = Math.max(0, Math.min(900, Math.floor((payload.expiresAt - Date.now()) / 1000)));
        return new Response(null, { status: 303, headers: {
          Location: url.pathname + url.search,
          'Set-Cookie': `${cookieName}=${grant}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`,
          'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        } });
      }
      const receiptBearer = url.pathname === '/__rer/release' && request.headers.get('Authorization') === `Bearer ${env.RER_PREVIEW_TOKEN}`;
      const cookie = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      if (!receiptBearer && (!cookie || !await verifyGrant(cookie, env))) return denied();
    }
    if (url.pathname === '/__rer/release') {
      if (!env.RER_RELEASE_DIGEST || !env.RER_VERSION_METADATA?.id) return new Response('Release identity unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
      return Response.json({ releaseDigest: env.RER_RELEASE_DIGEST, versionId: env.RER_VERSION_METADATA.id }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return worker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (env.RER_PREVIEW_TOKEN) return;
    if (worker.scheduled) return worker.scheduled(controller, env, ctx);
  },
  async queue(batch, env, ctx) {
    if (env.RER_PREVIEW_TOKEN) throw new Error('Preview queue effects are disabled');
    if (!worker.queue) throw new Error('Worker has no queue handler');
    return worker.queue(batch, env, ctx);
  },
};
