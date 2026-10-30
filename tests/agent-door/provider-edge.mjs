import { queueProvider } from './queue-provider.mjs';
// Disposable network provider only. Lamp still performs key custody, client
// assertions, OIDC correlation, PKCE, token validation and native admission.
export const IDENTITY_ORIGIN = 'https://lamp-agent-idp.example.invalid';
const CLIENT_ID = 'lamp-conformance-client';
const utf8 = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const json64 = value => encode(utf8.encode(JSON.stringify(value)));
const used = new Set();
let signing;
async function keys() {
  signing ??= (async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return { pair, public: { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: crypto.randomUUID(), alg: 'ES256', use: 'sig' } };
  })();
  return signing;
}
async function assertion(token, jwk, audience, subject) {
  if (typeof token !== 'string' || !jwk) throw new Error('Provider proof missing');
  const [head, body, signature, extra] = token.split('.');
  if (extra !== undefined || !head || !body || !signature) throw new Error('Provider proof malformed');
  const header = JSON.parse(new TextDecoder().decode(decode(head)));
  const claims = JSON.parse(new TextDecoder().decode(decode(body)));
  const now = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (header.alg !== 'ES256' || header.kid !== jwk.kid || claims.iss !== subject || claims.sub !== subject || claims.aud !== audience
    || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > now + 30 || claims.exp <= now || claims.exp - claims.iat > 300
    || typeof claims.jti !== 'string' || used.has(`assertion:${claims.jti}`)
    || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode(signature), utf8.encode(`${head}.${body}`))) throw new Error('Provider proof refused');
  used.add(`assertion:${claims.jti}`);
  return claims;
}
async function signedToken(claims) {
  const signing = await keys();
  const input = `${json64({ alg: 'ES256', kid: signing.public.kid, typ: 'JWT' })}.${json64(claims)}`;
  return `${input}.${encode(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signing.pair.privateKey, utf8.encode(input)))}`;
}

export default {
  async fetch(request, { fixture } = {}) {
    const queued = queueProvider(request, fixture);
    if (queued) return queued;
    const url = new URL(request.url);
    if (url.origin !== IDENTITY_ORIGIN) return new Response('Undeclared provider', { status: 502 });
    if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') return Response.json({
      issuer: IDENTITY_ORIGIN, authorization_endpoint: `${IDENTITY_ORIGIN}/authorize`, token_endpoint: `${IDENTITY_ORIGIN}/token`, jwks_uri: `${IDENTITY_ORIGIN}/jwks`,
      response_types_supported: ['code'], id_token_signing_alg_values_supported: ['ES256'], token_endpoint_auth_methods_supported: ['private_key_jwt'],
      code_challenge_methods_supported: ['S256'], rer_interfaces: ['oidc-provider@1.0.0'],
    });
    if (request.method === 'GET' && url.pathname === '/.well-known/rer-provider') return Response.json({
      issuer: IDENTITY_ORIGIN, interface: 'oidc-provider@1', version: 1,
      initiate: `${IDENTITY_ORIGIN}/link`, redeem: `${IDENTITY_ORIGIN}/redeem`, deregister: `${IDENTITY_ORIGIN}/remove`,
    });
    if (request.method === 'GET' && url.pathname === '/jwks') return Response.json({ keys: [(await keys()).public] });
    if (request.method === 'POST' && url.pathname === '/remove') return new Response(null, { status: 204 });
    try {
      const link = fixture?.link;
      if (request.method === 'POST' && url.pathname === '/redeem') {
        const input = await request.json();
        if (!link || input.code !== link.code || used.has(`link:${input.code}`) || input.origin !== link.origin || input.callback !== link.callback
          || input.interface !== 'oidc-provider@1' || input.client_assertion_type !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') throw new Error('Invalid link grant');
        const proof = await assertion(input.client_assertion, link.publicKey, url.href, link.origin);
        if (proof.code !== link.code || proof.callback !== link.callback || proof.sector_id !== link.sector || proof.interface !== 'oidc-provider@1') throw new Error('Invalid link proof');
        used.add(`link:${input.code}`);
        return Response.json({ issuer: IDENTITY_ORIGIN, interface: 'oidc-provider@1', origin: link.origin, callback: link.callback,
          sector_id: link.sector, client_id: CLIENT_ID, continuity: 'provider-owner' });
      }
      if (request.method === 'POST' && url.pathname === '/token') {
        const grant = fixture?.authorization;
        const form = new URLSearchParams(await request.text());
        if (!link || !grant || grant.client_id !== CLIENT_ID || grant.response_type !== 'code' || grant.code_challenge_method !== 'S256'
          || form.get('code') !== grant.code || used.has(`code:${grant.code}`) || form.get('client_id') !== CLIENT_ID
          || form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== grant.redirect_uri || request.headers.has('Authorization')
          || form.has('client_secret') || form.get('client_assertion_type') !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
          || encode(await crypto.subtle.digest('SHA-256', utf8.encode(form.get('code_verifier') ?? ''))) !== grant.code_challenge) throw new Error('Invalid authorization grant');
        await assertion(form.get('client_assertion'), link.publicKey, url.href, CLIENT_ID);
        used.add(`code:${grant.code}`);
        const now = Math.floor(Date.now() / 1000);
        return Response.json({ access_token: crypto.randomUUID(), token_type: 'Bearer', id_token: await signedToken({
          iss: IDENTITY_ORIGIN, sub: grant.subject, aud: CLIENT_ID, iat: now, exp: now + 300,
          nonce: grant.nonce, email: grant.email, email_verified: true, email_verified_at: now,
        }) });
      }
    } catch {
      return Response.json({ error: 'invalid_grant' }, { status: 403 });
    }
    return new Response('Provider route unavailable', { status: 404 });
  },
};
