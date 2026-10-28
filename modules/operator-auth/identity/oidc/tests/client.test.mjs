import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, authProvider, clientKey, ORIGIN, sessionCookie } from './runtime.mjs';
import { keys } from './idp.mjs';
import { createOperatorAuth, createAuthHandler, createSignInHandler } from '../../../index.mjs';
import { createOidcHandler } from '../index.mjs';
async function fixture(t, entries, core) { const r = await runtime(entries, core); t.after(() => r.close()); return r; }
async function denied(response, status = 400) { assert.equal(response.status, status, await response.clone().text()); assert.ok(!response.headers.get('set-cookie')?.includes('__Host-operator_session=')); }

test('real PKCE exchange, private_key_jwt and a signed token admit through the real operator store, across a restart', async t => {
  const r = await fixture(t); await r.bootstrap();
  const f = await r.flow('/app/tickets?mine=1');
  assert.notEqual(f.location.searchParams.get('nonce'), f.state);
  assert.notEqual(f.cookie.split('=')[1], f.state);
  assert.equal(f.location.searchParams.get('redirect_uri'), `${ORIGIN}/auth/oidc/auth/callback`);
  assert.match(f.start.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  const row = r.sqlite.prepare('SELECT * FROM oa_oidc_transactions').get();
  for (const secret of [f.state, f.cookie.split('=')[1], f.location.searchParams.get('nonce')]) assert.ok(!JSON.stringify(row).includes(secret));
  r.restart();
  const response = await r.finish(f); assert.equal(response.status, 303, await response.clone().text());
  assert.equal(response.headers.get('location'), '/app/tickets?mine=1');
  const session = await r.auth.getSession(r.request('/app', { cookie: sessionCookie(response) }));
  assert.equal(session.kind, 'oidc'); assert.equal(session.operator.email, 'owner@example.com');
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM oa_operators').get().n, 1);
  assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM oa_oidc_transactions').get().n, 0);
  await denied(await r.finish(f));
  assert.equal(r.provider.requests.filter(x => x.uri.endsWith('/token')).length, 1);
});

test('parallel callback claims once and maintains independent browser tabs', async t => {
  const r = await fixture(t); await r.bootstrap(); const a = await r.flow(); const b = await r.flow();
  const responses = await Promise.all([r.finish(a), r.finish(a)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [303, 400]);
  assert.equal((await r.finish(b)).status, 303);
});

test('wrong/missing/duplicate binding, duplicate state, swapped state cannot consume a valid login', async t => {
  const r = await fixture(t); await r.bootstrap(); const f = await r.flow(); const other = await r.flow();
  await denied(await r.finish(f, { cookie: undefined }));
  await denied(await r.finish(f, { cookie: other.cookie }));
  await denied(await r.finish(f, { cookie: `${f.cookie}; ${f.cookie}` }));
  await denied(await r.finish({ ...f, path: f.path + `&state=${f.state}` }));
  await denied(await r.finish({ ...f, path: f.path + `&code=${f.code}` }));
  assert.equal((await r.finish(f)).status, 303);
});

test('start requires exact Origin, host, POST; callback exact route and GET', async t => {
  const r = await fixture(t); await r.bootstrap();
  await denied(await r.call('/auth/oidc/auth/start'), 405);
  await denied(await r.call('/auth/oidc/auth/start', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: {} }), 403);
  await denied(await r.call('/auth/oidc/auth/start', { method: 'POST', headers: { Host: 'attacker.example' }, body: {} }), 403);
  await denied(await r.call('/auth/oidc/auth/start', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: {} }), 403);
  await denied(await r.call('/auth/oidc/unknown/start', { method: 'POST', body: {} }), 404);
  const f = await r.flow(); await denied(await r.finish(f, { method: 'HEAD' }), 405);
  await denied(await r.finish(f, { headers: { Host: 'attacker.example' } }), 403);
  assert.equal((await r.finish(f)).status, 303);
});

test('returnTo is saved and cannot be overwritten by callback', async t => {
  const r = await fixture(t); await r.bootstrap(); const f = await r.flow('https://evil.example');
  const response = await r.finish({ ...f, path: f.path + '&returnTo=https://evil.example' });
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/app');
});

test('unknown and inactive operators never join; native policy governs later session admission', async t => {
  const unknown = await fixture(t); const f = await unknown.flow(); await denied(await unknown.finish(f), 403);
  assert.equal(unknown.sqlite.prepare('SELECT COUNT(*) AS n FROM oa_operators').get().n, 0);
  const r = await fixture(t); await r.bootstrap();
  const f2 = await r.flow(); r.sqlite.prepare("UPDATE oa_operators SET email='another@example.com'").run();
  await denied(await r.finish(f2), 403);
});

// Issuer, audience, `none`, HS256, unlisted algorithms and unknown keys are proven
// through workerd in providers.test.mjs; these are the remaining token and key checks.
for (const [name, change] of Object.entries({
  multipleAudienceNoAzp: p => { p.options.claims = { ...p.options.claims, aud: ['client', 'other'] }; },
  azp: p => { p.options.claims = { ...p.options.claims, azp: 'another-client' }; },
  expired: p => { p.options.claims = { ...p.options.claims, exp: 1 }; },
  futureIat: p => { p.options.claims = { ...p.options.claims, iat: 9999999999, exp: 10000000000 }; },
  staleIat: p => { p.options.claims = { ...p.options.claims, iat: 1 }; },
  futureNbf: p => { p.options.claims = { ...p.options.claims, nbf: 9999999999 }; },
  nonce: p => { p.options.claims = { ...p.options.claims, nonce: '$other' }; },
  stringEmailVerified: p => { p.options.claims = { ...p.options.claims, email_verified: 'true' }; },
  badAtHash: p => { p.options.claims = { ...p.options.claims, at_hash: 'invalid' }; },
  badCodeHash: p => { p.options.claims = { ...p.options.claims, c_hash: 'invalid' }; },
  signature: p => { p.options.corruptSignature = true; },
  headerJwk: p => { p.options.header = { jwk: {} }; },
  headerJku: p => { p.options.header = { jku: 'https://attacker.example' }; },
  critical: p => { p.options.header = { crit: [] }; },
  keyUse: p => { p.options.jwks = [{ ...p.key.public, use: 'enc' }]; },
  duplicateKid: p => { p.options.jwks = [p.key.public, p.key.public]; },
  keyAlgorithm: p => { p.options.jwks = [{ ...p.key.public, alg: 'HS256' }]; },
  keyOps: p => { p.options.jwks = [{ ...p.key.public, key_ops: ['sign', 'verify'] }]; },
  wrongTokenType: p => { p.options.token = { token_type: 'mac' }; },
})) test(`rejects ${name} and consumes the correlation before any retry`, async t => {
  const r = await fixture(t); await r.bootstrap(); change(r.provider); const f = await r.flow(); const response = await r.finish(f);
  assert.ok(response.status >= 400); assert.ok(!response.headers.get('set-cookie')?.includes('__Host-operator_session='));
  await denied(await r.finish(f));
  assert.equal(r.sqlite.prepare("SELECT COUNT(*) AS n FROM oa_sessions WHERE kind='oidc'").get().n, 0);
});

test('Google with client_secret_post and Okta with an RS256 private_key_jwt are genuine protocol variations', async t => {
  const google = await fixture(t, [{ config: { id: 'google', preset: 'google', clientId: 'client', tokenAuthMethod: 'client_secret_post', clientSecret: 'fixture-secret' },
    fake: { issuer: 'https://accounts.google.com', method: 'client_secret_post', claims: { hd: 'example.com' } } }]);
  await google.bootstrap(); assert.equal((await google.finish(await google.flow())).status, 303);
  const okta = await fixture(t, [{ config: { id: 'okta', preset: 'okta', issuer: 'https://example.okta.com', clientId: 'client', privateKey: clientKey.RS256.private, subjectEmails: { 'operator-subject': 'owner@example.com' } },
    fake: { issuer: 'https://example.okta.com', method: 'private_key_jwt', clientKey: clientKey.RS256.public } }]);
  await okta.bootstrap(); assert.equal((await okta.finish(await okta.flow())).status, 303);
  const assertion = okta.provider.requests.filter(x => x.uri.endsWith('/token'));
  assert.equal(assertion.length, 1);
});

test('Microsoft style unverified email only works with an explicit subject association', async t => {
  const entry = subjectEmails => ({ config: { id: 'microsoft', preset: 'microsoft', tenant: 'contoso.example', clientId: 'client', clientSecret: 'fixture-secret', tokenAuthMethod: 'client_secret_basic', subjectEmails },
    fake: { issuer: 'https://login.microsoftonline.com/contoso.example/v2.0', claims: { email_verified: true, email: 'owner@example.com' } } });
  const unmapped = await fixture(t, [entry(undefined)]); await unmapped.bootstrap();
  await denied(await unmapped.finish(await unmapped.flow()), 403);
  const mapped = await fixture(t, [entry({ 'operator-subject': 'owner@example.com' })]); await mapped.bootstrap();
  mapped.provider.options.claims = { email: 'mutable@untrusted.example', email_verified: false };
  assert.equal((await mapped.finish(await mapped.flow())).status, 303);
});

test('response issuer enforced when advertised, and mismatches always rejected', async t => {
  const r = await fixture(t, [authProvider({}, { metadata: { authorization_response_iss_parameter_supported: true } })]); await r.bootstrap();
  await denied(await r.finish(await r.flow()));
  const f = await r.flow(); await denied(await r.finish({ ...f, path: f.path + '&iss=https://evil.example' }));
  const good = await r.flow(); assert.equal((await r.finish({ ...good, path: good.path + '&iss=https://idp.example' })).status, 303);
});

test('expired correlations and altered encryption fail closed; a completed re-link invalidates logins in flight', async t => {
  const r = await fixture(t); await r.bootstrap(); const f = await r.flow();
  r.sqlite.prepare('UPDATE oa_oidc_transactions SET expires_at=0').run(); await denied(await r.finish(f));
  const altered = await r.flow(); r.sqlite.prepare("UPDATE oa_oidc_transactions SET payload='bad.ciphertext'").run();
  await denied(await r.finish(altered), 503);
  const inFlight = await r.flow();
  // The owner re-links the provider under a new client registration.
  const relinked = createOperatorAuth({ db: r.db, clientIp: () => '192.0.2.1', fetch: r.provider.fetch, config: { origin: ORIGIN, OWNER_EMAIL: 'owner@example.com',
    SESSION_SECRET: 'test-only-real-core-session-secret', OIDC_TRANSACTION_SECRET: 'test-only-independent-correlation-secret', providers: [authProvider({ clientId: 'client-2' }).config] } });
  assert.equal(r.sqlite.prepare('SELECT pending_client_id AS c FROM oa_identity_providers').get().c, null);
  await relinked.providers.relink('auth');
  assert.equal(r.sqlite.prepare('SELECT client_id AS c FROM oa_identity_providers').get().c, 'client-2');
  await denied(await r.finish(inFlight));
});

test('discovery and requests enforce trust, size, redirects, timeout; diagnostics are redacted', async t => {
  for (const metadata of [{ issuer: 'https://evil.example' }, { token_endpoint: 'https://evil.example/token' }, { authorization_endpoint: 'http://idp.example/auth' }, { jwks_uri: 'https://idp.example/jwks?secret=fixture' }, { code_challenge_methods_supported: ['plain'] }]) {
    const r = await fixture(t, [authProvider({}, { metadata })]); assert.ok((await r.begin()).status >= 400);
  }
  for (const transport of [async () => Response.redirect('https://evil.example', 302), async () => new Response('x'.repeat(70000), { headers: { 'Content-Type': 'application/json' } }), async () => { throw new Error('provider-secret-must-not-leak'); }, async () => new Promise(() => {})]) {
    const r = await fixture(t, [authProvider({}, { transport })], { identityTimeoutMs: 100 }); const response = await r.begin();
    assert.equal(response.status, 502); assert.equal(await response.text(), '{"error":"oidc_provider_unavailable"}');
  }
});

test('rate limiting is durable and request bodies bounded', async t => {
  const r = await fixture(t, undefined, { identityStartLimit: 1 }); assert.equal((await r.begin()).status, 303); r.restart();
  await denied(await r.begin(), 429);
  await denied(await r.call('/auth/oidc/auth/start', { method: 'POST', body: 'x'.repeat(4097) }), 413);
});

test('providers are pinned to their presets: only HTTPS issuers, tenant issuers, preset algorithms and methods, no GitHub', async t => {
  const r = await fixture(t);
  const base = { origin: ORIGIN, OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-only-real-core-session-secret', OIDC_TRANSACTION_SECRET: 'test-only-independent-correlation-secret' };
  const good = authProvider().config;
  for (const invalid of [{ issuer: 'http://idp.example' }, { preset: 'github' }, { preset: 'generic' }, { tokenAuthMethod: 'none' }, { tokenAuthMethod: 'client_secret_basic', clientSecret: 'x', privateKey: undefined },
    { id: 'Bad Id' }, { privateKey: { ...clientKey.ES256.private, kid: undefined } }, { minimumVersion: '0.9.0' }, { preset: 'microsoft', tenant: 'common', issuer: undefined }, { preset: 'google', issuer: 'https://evil.example' }]) {
    assert.throws(() => createOperatorAuth({ db: r.db, clientIp: () => '192.0.2.1', config: { ...base, providers: [{ ...good, ...invalid }] } }).providers, e => e.code === 'oidc_invalid_configuration', JSON.stringify(invalid));
  }
  assert.throws(() => createOperatorAuth({ db: r.db, clientIp: () => '192.0.2.1', config: { ...base, OIDC_TRANSACTION_SECRET: undefined, providers: [good] } }), e => e.code === 'invalid_configuration');
  assert.throws(() => createOperatorAuth({ db: r.db, clientIp: () => '192.0.2.1', config: { ...base, providers: [good, good] } }), e => e.code === 'oidc_invalid_configuration');
  const local = createOperatorAuth({ db: r.db, clientIp: () => '192.0.2.1', fetch: r.provider.fetch, config: { ...base, local: true, origin: 'http://localhost:4321', providers: [good] } });
  const headers = { Host: 'localhost:4321', Origin: 'http://localhost:4321', 'Content-Type': 'application/json' };
  const ok = await local.providers.begin(new Request('http://localhost:4321/auth/oidc/auth/start', { method: 'POST', headers, body: '{}' }), 'auth');
  assert.equal(ok.status, 303); assert.match(ok.headers.get('set-cookie'), /^oa_oidc_local_/); assert.ok(!ok.headers.get('set-cookie').includes('; Secure'));
  const bad = await local.providers.begin(new Request('http://localhost:4321/auth/oidc/auth/start', { method: 'POST', headers: { Origin: 'http://localhost:4321' } }), 'auth'); assert.equal(bad.status, 403);
});

test('multiple audiences require explicit trust of every extra audience plus matching azp', async t => {
  const claims = { aud: ['client', 'api-resource'], azp: 'client' };
  const untrusted = await fixture(t, [authProvider({}, { claims })]); await untrusted.bootstrap();
  assert.equal((await untrusted.finish(await untrusted.flow())).status, 400);
  const trusted = await fixture(t, [authProvider({ additionalAudiences: ['api-resource'] }, { claims })]); await trusted.bootstrap();
  assert.equal((await trusted.finish(await trusted.flow())).status, 303);
});

test('a substituted key under a known kid fails without a refetch', async t => {
  const r = await fixture(t); await r.bootstrap(); assert.equal((await r.finish(await r.flow())).status, 303);
  const intruder = await keys('ES256');
  r.provider.options.signingKey = { ...intruder, public: { ...intruder.public, kid: r.provider.key.public.kid } };
  const before = r.provider.requests.filter(x => x.uri.endsWith('/jwks')).length;
  assert.equal((await r.finish(await r.flow())).status, 400);
  assert.equal(r.provider.requests.filter(x => x.uri.endsWith('/jwks')).length, before);
});

// Refusing an owned upload must finish it before the adapter returns. Optional
// adapters must leave downstream bodies alone when they decline ownership.
test('owned early HTTP refusals drain input, while unowned requests remain available downstream', async () => {
  const r = await runtime();
  try {
    const auth = createAuthHandler(r.auth), oidc = createOidcHandler(r.auth.providers);
    for (const [handler, path, status] of [
      [auth, '/auth/unknown', 404],
      [auth, '/auth/bootstrap?token=refused', 400],
      [auth, '/auth/magic-link', 415],
      [oidc, '/auth/oidc/auth/start', 415],
      [oidc, '/auth/oidc/auth/callback', 405],
    ]) {
      let completed = false;
      const chunks = ['unread ', 'input'].map(text => new TextEncoder().encode(text));
      const body = new ReadableStream({ pull(controller) {
        if (chunks.length) controller.enqueue(chunks.shift());
        else { completed = true; controller.close(); }
      } }, { highWaterMark: 0 });
      const request = new Request(r.request(path, { method: 'POST', headers: { 'Content-Type': 'text/plain' } }), { body, duplex: 'half' });
      const response = await handler(request);
      assert.equal(response.status, status);
      assert.equal(completed, true, 'the complete upload was discarded before responding');
      assert.equal(request.bodyUsed, true);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const [handler, path] of [[auth, '/application'], [oidc, '/auth/oidc/unknown/start'], [createSignInHandler(r.auth), '/signin']]) {
      const request = r.request(path, { method: 'POST', body: 'downstream input' });
      assert.equal(await handler(request), null);
      assert.equal(request.bodyUsed, false);
      assert.equal(await request.text(), 'downstream input');
    }
    assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM oa_operators').get().n, 0);
    assert.equal(r.sqlite.prepare('SELECT COUNT(*) AS n FROM oa_sessions').get().n, 0);
  } finally { await r.close(); }
});
