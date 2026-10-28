// Test-only cryptographic OpenID provider and wire transport: the provider edge
// that the fake-provider tests stand in for. Product code never imports this.
// It runs in Node and inside workerd (WebCrypto and fetch Responses only).
import { digest, encode, decode, utf8, random } from '../crypto.mjs';

const ALGORITHMS = { RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, ES256: { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } };
export async function keys(alg = 'RS256') {
  const algorithm = alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } : { name: 'ECDSA', namedCurve: 'P-256' };
  const pair = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const kid = random();
  return { public: { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid, alg, use: 'sig' }, private: { ...await crypto.subtle.exportKey('jwk', pair.privateKey), kid, alg } };
}
export async function sign(key, claims, header = {}) {
  const alg = key.public.alg;
  const { kid: _, alg: __, ...jwk } = key.private;
  const privateKey = await crypto.subtle.importKey('jwk', jwk, ALGORITHMS[alg], false, ['sign']);
  const input = `${encode(utf8.encode(JSON.stringify({ alg, kid: key.public.kid, typ: 'JWT', ...header })))}.${encode(utf8.encode(JSON.stringify(claims)))}`;
  return `${input}.${encode(await crypto.subtle.sign(ALGORITHMS[alg], privateKey, utf8.encode(input)))}`;
}
async function verifyAssertion(assertion, publicKey) {
  const [h, b, s] = assertion.split('.');
  const header = JSON.parse(new TextDecoder().decode(decode(h)));
  const key = await crypto.subtle.importKey('jwk', (({ kid, alg, use, key_ops, ...k }) => k)(publicKey), ALGORITHMS[header.alg], false, ['verify']);
  if (header.kid !== publicKey.kid || !await crypto.subtle.verify(ALGORITHMS[header.alg], key, decode(s), utf8.encode(`${h}.${b}`))) return null;
  return JSON.parse(new TextDecoder().decode(decode(b)));
}

/**
 * One provider. options: issuer, alg, clientId, method ('private_key_jwt' |
 * 'client_secret_basic' | 'client_secret_post' | 'none'), clientSecret, clientKey
 * (the app's public JWK for private_key_jwt), redirectUri, metadata, claims,
 * header, jwks, signingKey, corruptSignature, token, transport, rerInterfaces.
 * Every option stays mutable on .options so a test can change the provider's
 * behaviour between sign-ins.
 */
export async function provider(input) {
  const key = input.key ?? await keys(input.alg ?? 'RS256');
  const options = { clientId: 'client', method: 'client_secret_basic', clientSecret: 'fixture-secret', ...input, key };
  const requests = []; const assertions = new Set();
  // Grants live in memory, or in a store the caller supplies (a workerd test keeps them in D1).
  const memory = new Map();
  const grants = input.grants ?? { async put(code, grant) { memory.set(code, grant); }, async take(code) { const grant = memory.get(code); memory.delete(code); return grant; }, delete: code => memory.delete(code) };
  const now = () => Math.floor((input.now?.() ?? Date.now()) / 1000);
  const issuer = options.issuer;
  const metadata = () => ({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'],
    id_token_signing_alg_values_supported: [key.public.alg], token_endpoint_auth_methods_supported: [options.method], code_challenge_methods_supported: ['S256'],
    ...(options.rerInterfaces ? { rer_interfaces: options.rerInterfaces } : {}), ...options.metadata });
  const api = {
    key, options, grants, requests, issuer, metadata,
    /** The browser at the authorization endpoint: the provider grants a code for this request. */
    async authorize(location, claims = {}) {
      const url = new URL(location); const p = url.searchParams; const m = metadata();
      if (url.origin + url.pathname !== m.authorization_endpoint || p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256'
        || p.get('redirect_uri') !== options.redirectUri || p.get('client_id') !== options.clientId) throw new Error('Bad authorization request');
      const code = random(); await grants.put(code, { ...Object.fromEntries(p), claims }); return { code, state: p.get('state') };
    },
    async fetch(uri, init = {}) {
      uri = String(uri);
      requests.push({ uri, method: init.method, redirect: init.redirect });
      if (options.transport) { const response = await options.transport(uri, init); if (response) return response; }
      const m = metadata();
      if (uri === `${issuer}/.well-known/openid-configuration`) return Response.json(m);
      if (uri === m.jwks_uri) return Response.json({ keys: options.jwks ?? [key.public] });
      if (uri !== m.token_endpoint || init.method !== 'POST' || init.redirect !== 'manual') return new Response('Not found', { status: 404 });
      const form = new URLSearchParams(init.body); const code = form.get('code'); const grant = await grants.take(code);
      if (!grant || form.get('grant_type') !== 'authorization_code' || form.get('client_id') !== grant.client_id || form.get('redirect_uri') !== grant.redirect_uri || await digest(form.get('code_verifier')) !== grant.code_challenge) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const headers = init.headers ?? {};
      if (options.method === 'client_secret_basic' && headers.Authorization !== `Basic ${btoa(`${options.clientId}:${options.clientSecret}`)}`
        || options.method === 'client_secret_post' && form.get('client_secret') !== options.clientSecret
        || options.method === 'none' && (form.has('client_secret') || headers.Authorization)) return Response.json({ error: 'invalid_client' }, { status: 401 });
      if (options.method === 'private_key_jwt') {
        // RFC 7523: no shared secret, a signed one-use assertion addressed to this token endpoint.
        const claims = form.get('client_assertion_type') === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' && !form.has('client_secret') && !headers.Authorization
          ? await verifyAssertion(form.get('client_assertion') ?? '', options.clientKey) : null;
        if (!claims || claims.iss !== options.clientId || claims.sub !== options.clientId || claims.aud !== m.token_endpoint || !(claims.exp > now()) || claims.exp - claims.iat > 300 || assertions.has(claims.jti)) return Response.json({ error: 'invalid_client' }, { status: 401 });
        assertions.add(claims.jti);
      }
      const iat = now();
      const claims = { iss: issuer, sub: 'operator-subject', aud: options.clientId, iat, exp: iat + 300, nonce: grant.nonce, email: 'owner@example.com', email_verified: true, ...options.claims, ...grant.claims };
      if (claims.nonce === '$other') claims.nonce = random();
      let token = await sign(options.signingKey ?? key, claims, options.header);
      if (options.corruptSignature) token = token.slice(0, -8) + 'AAAAAAAA';
      return Response.json({ access_token: random(), token_type: 'Bearer', id_token: token, ...options.token });
    },
  };
  return api;
}

/** Several providers behind one transport, as the network edge of one app. */
export function network(providers) {
  return async (uri, init) => {
    const target = providers.find(p => String(uri).startsWith(`${p.issuer}/`));
    if (!target) throw new TypeError('getaddrinfo ENOTFOUND');
    return target.fetch(uri, init);
  };
}
