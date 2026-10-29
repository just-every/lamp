// Fake-provider tests through the public HTTP door, in real workerd with D1.
// Fakes stand only at the provider edge (fake-worker.mjs); everything else is
// the production module: createOperatorAuth, createAuthHandler and the sign-in page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtime, presets, MICROSOFT, json } from './fake-runtime.mjs';
import { STEP_UP_ACTIONS } from '../../../index.mjs';

const day = 86400;
async function signedIn(r, response, email) {
  assert.equal(response.status, 303, await response.clone().text());
  const cookie = r.session(response);
  const who = await json(await r.call('/test/private', { cookie }));
  assert.deepEqual([who.status, who.body.kind, who.body.email], [200, 'oidc', email]);
  return cookie;
}
async function refused(r, response, status, code) {
  assert.equal(response.status, status, await response.clone().text());
  if (code) assert.equal((await response.json()).error, code);
  assert.equal(r.session(response), undefined);
}
const sessions = async r => (await r.db.prepare("SELECT COUNT(*) AS n FROM oa_sessions WHERE kind='oidc'").first()).n;

test('each preset signs in on its happy path, and linking pins issuer, JWKS URI, client id and the preset algorithm', async t => {
  const r = await runtime(t); const owner = await r.bootstrap(); await r.operator('member@example.com');
  await signedIn(r, await r.login('auth'), 'owner@example.com');
  await signedIn(r, await r.login('google'), 'owner@example.com');
  await signedIn(r, await r.login('microsoft'), 'member@example.com');
  await signedIn(r, await r.login('okta'), 'member@example.com');
  const pins = Object.fromEntries((await json(await r.call('/auth/providers', { cookie: owner }))).body.map(p => [p.id, p]));
  assert.deepEqual(Object.keys(pins).sort(), ['auth', 'google', 'microsoft', 'okta']);
  assert.deepEqual([pins.auth.issuer, pins.auth.jwks, pins.auth.clientId, pins.auth.algorithms, pins.auth.tokenAuthMethod, pins.auth.interfaceVersion],
    ['https://id.example', 'https://id.example/jwks', 'app-at-auth', ['ES256'], 'private_key_jwt', '1.0.0']);
  assert.deepEqual([pins.google.issuer, pins.google.algorithms], ['https://accounts.google.com', ['RS256']]);
  assert.deepEqual([pins.microsoft.issuer, pins.microsoft.algorithms, pins.microsoft.tokenAuthMethod], [MICROSOFT, ['RS256'], 'private_key_jwt']);
  assert.deepEqual([pins.okta.issuer, pins.okta.algorithms, pins.okta.clientId], ['https://corp.okta.example', ['RS256'], 'app-at-okta']);
  // Each provider has its own redirect URI.
  for (const id of ['auth', 'google', 'microsoft', 'okta']) assert.equal(new URL((await r.flow(id)).location).searchParams.get('redirect_uri'), `https://app.example/auth/oidc/${id}/callback`);
  // private_key_jwt sends no shared secret: the Auth fake verified a signed assertion.
  assert.ok((await r.requests('https://id.example')).some(x => x.uri === 'https://id.example/token'));
});

test('mix-up: an authorization response from provider A replayed at provider B redirect URI is refused, and A still completes', async t => {
  const r = await runtime(t); await r.bootstrap();
  const a = await r.flow('auth'); const b = await r.flow('okta');
  // A's code and state at B's callback, with B's browser binding and then with A's.
  await refused(r, await r.call(`/auth/oidc/okta/callback?state=${a.state}&code=${a.code}`, { cookie: b.cookie }), 400, 'oidc_invalid_correlation');
  await refused(r, await r.call(`/auth/oidc/okta/callback?state=${a.state}&code=${a.code}`, { cookie: a.cookie }), 400, 'oidc_invalid_correlation');
  await refused(r, await r.call(`/auth/oidc/okta/callback?state=${a.state}&code=${a.code}&iss=${encodeURIComponent('https://id.example')}`, { cookie: a.cookie }), 400);
  assert.equal(await sessions(r), 0);
  // No code reached B's token endpoint; A's transaction is untouched.
  assert.equal((await r.requests('https://corp.okta.example')).filter(x => x.uri.endsWith('/token')).length, 0);
  await signedIn(r, await r.finish(a), 'owner@example.com');
  // An RFC 9207 iss naming the other provider is refused at A's own callback.
  const again = await r.flow('auth');
  await refused(r, await r.finish({ ...again, path: `${again.path}&iss=${encodeURIComponent('https://corp.okta.example')}` }), 400, 'oidc_issuer_mismatch');
});

test('a wrong ID-token iss or aud is refused', async t => {
  const r = await runtime(t); await r.bootstrap();
  await refused(r, await r.login('auth', { iss: 'https://corp.okta.example' }), 400, 'oidc_issuer_mismatch');
  await refused(r, await r.login('auth', { aud: 'app-at-okta' }), 400, 'oidc_audience_mismatch');
  await refused(r, await r.login('google', { aud: ['app-at-google', 'someone-else'], azp: 'app-at-google' }), 400, 'oidc_audience_mismatch');
  assert.equal(await sessions(r), 0);
});

test('alg none, HS256 and an algorithm the link did not pin are refused before any key is used', async t => {
  const r = await runtime(t); await r.bootstrap();
  for (const alg of ['none', 'HS256']) {
    await r.set('https://id.example', { header: { alg } });
    await refused(r, await r.login('auth'), 400, 'oidc_algorithm_refused');
  }
  // RS256 is not in the Auth pin (ES256 only); ES256 is not in Google's (RS256 only).
  await r.set('https://id.example', { header: {}, signingKeyName: 'googleSigning', jwksNames: ['authSigning', 'googleSigning'] });
  await refused(r, await r.login('auth'), 400, 'oidc_algorithm_refused');
  await r.set('https://accounts.google.com', { signingKeyName: 'authSigning', jwksNames: ['googleSigning', 'authSigning'] });
  await refused(r, await r.login('google'), 400, 'oidc_algorithm_refused');
  assert.equal(await sessions(r), 0);
});

test('an unknown kid refetches JWKS once: a rotated key is then accepted, a key still unknown is refused', async t => {
  const r = await runtime(t); await r.bootstrap();
  await signedIn(r, await r.login('auth'), 'owner@example.com');
  const fetches = async () => (await r.requests('https://id.example')).filter(x => x.uri.endsWith('/jwks')).length;
  const first = await fetches();
  await signedIn(r, await r.login('auth'), 'owner@example.com');
  assert.equal(await fetches(), first, 'a known kid uses the pinned key set without fetching');
  await r.set('https://id.example', { signingKeyName: 'authRotated', jwksNames: ['authSigning', 'authRotated'] });
  await signedIn(r, await r.login('auth'), 'owner@example.com');
  assert.equal(await fetches(), first + 1, 'one refetch found the rotated key');
  await r.set('https://id.example', { signingKeyName: 'nextSigning', jwksNames: ['authSigning', 'authRotated'] });
  await refused(r, await r.login('auth'), 400, 'oidc_unknown_key');
  assert.equal(await fetches(), first + 2, 'exactly one more refetch before refusing');
});

test('a replayed state is refused, also after a restart', async t => {
  const r = await runtime(t); await r.bootstrap();
  const f = await r.flow('auth');
  await signedIn(r, await r.finish(f), 'owner@example.com');
  await refused(r, await r.finish(f), 400, 'oidc_invalid_correlation');
  await r.restart();
  await refused(r, await r.finish(f), 400, 'oidc_invalid_correlation');
  const parallel = await r.flow('auth');
  const outcomes = await Promise.all([r.finish(parallel), r.finish(parallel)]);
  assert.deepEqual(outcomes.map(o => o.status).sort(), [303, 400]);
});

test('production refuses amr dev and emails under .localhost, .test or .invalid', async t => {
  const r = await runtime(t); await r.bootstrap();
  await refused(r, await r.login('auth', { amr: ['dev'] }), 403, 'oidc_admission_denied');
  for (const domain of ['dev.localhost', 'example.test', 'example.invalid']) {
    await r.operator(`person@${domain}`);
    await refused(r, await r.login('auth', { sub: `sub-${domain}`, email: `person@${domain}` }), 403);
  }
  assert.equal(await sessions(r), 0);
});

// A Gmail address is formed at run time, so no mailbox address is published in source.
const gmail = ['someone', 'gmail.com'].join('@');
test('email trust: unverified, stale (31 days) and unproven emails are refused; a 29-day proof and Google with hd or @gmail.com count', async t => {
  const r = await runtime(t); await r.bootstrap(); await r.operator('member@example.com'); await r.operator(gmail);
  const now = Math.floor(Date.now() / 1000);
  await refused(r, await r.login('auth', { sub: 'u1', email: 'member@example.com', email_verified: false }), 403);
  await refused(r, await r.login('auth', { sub: 'u2', email: 'member@example.com', email_verified_at: now - 31 * day }), 403);
  await refused(r, await r.login('auth', { sub: 'u3', email: 'member@example.com', email_verified_at: null }), 403);
  // Google without hd for a non-Gmail address, and Okta's verified email without an association, prove nothing.
  await refused(r, await r.login('google', { sub: 'g1', email: 'member@example.com', hd: null }), 403);
  await refused(r, await r.login('okta', { sub: 'unmapped', email: 'member@example.com', email_verified: true }), 403);
  assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM oa_external_identities').first()).n, 0, 'nothing unproven was bound');
  await signedIn(r, await r.login('auth', { sub: 'u4', email: 'member@example.com', email_verified_at: now - 29 * day }), 'member@example.com');
  await signedIn(r, await r.login('google', { sub: 'g2', email: gmail, hd: null }), gmail);
});

test('bindings on (iss, sub) are never silently rebound; a proven email binds once per issuer; binding revokes passwords', async t => {
  const r = await runtime(t); await r.bootstrap(); await r.operator('member@example.com');
  const password = await r.call('/test/password', { method: 'POST', input: { operatorId: 'member' } });
  assert.equal(password.status, 204);
  const passwordCookie = r.session(password);
  await signedIn(r, await r.login('auth', { sub: 'member-a', email: 'member@example.com' }), 'member@example.com');
  assert.equal((await r.call('/test/private', { cookie: passwordCookie })).status, 401, 'the earlier password session ended');
  assert.equal((await json(await r.call('/test/password', { method: 'POST', input: { operatorId: 'member' } }))).body.error, 'password_revoked');
  // Another subject at the same issuer presenting the same proven email cannot join.
  await refused(r, await r.login('auth', { sub: 'member-b', email: 'member@example.com' }), 403);
  // The bound subject presenting someone else's email still cannot move.
  await refused(r, await r.login('auth', { sub: 'member-a', email: 'owner@example.com' }), 403);
  // Another issuer with a proven email binds its own principal.
  await signedIn(r, await r.login('google', { sub: 'google-member', email: 'member@example.com' }), 'member@example.com');
  // Concurrent first sign-ins at one issuer bind exactly one principal.
  await r.operator('racer@example.com');
  const [a, b] = [await r.flow('auth', { sub: 'racer-a', email: 'racer@example.com' }), await r.flow('auth', { sub: 'racer-b', email: 'racer@example.com' })];
  assert.deepEqual((await Promise.all([r.finish(a), r.finish(b)])).map(o => o.status).sort(), [303, 403]);
  const rows = (await r.db.prepare('SELECT issuer,subject,operator_id AS operatorId FROM oa_external_identities ORDER BY issuer,subject').all()).results;
  assert.deepEqual(rows.filter(row => row.operatorId === 'member'), [{ issuer: 'https://accounts.google.com', subject: 'google-member', operatorId: 'member' }, { issuer: 'https://id.example', subject: 'member-a', operatorId: 'member' }]);
  assert.equal(rows.filter(row => row.operatorId === 'racer').length, 1);
});

test('a pending invitation is accepted through a provider that proves the invited email', async t => {
  const r = await runtime(t); const owner = await r.bootstrap();
  assert.equal((await r.call('/auth/invite', { method: 'POST', input: { email: 'invited@example.com', displayName: 'Invited' }, cookie: owner })).status, 202);
  await signedIn(r, await r.login('auth', { sub: 'invited-sub', email: 'invited@example.com' }), 'invited@example.com');
  assert.deepEqual(await r.db.prepare("SELECT status,version FROM oa_operators WHERE email='invited@example.com'").first(), { status: 'active', version: 2 });
  await refused(r, await r.call(`/auth/confirm`, { method: 'POST', input: { token: await r.link() } }), 400);
});

test('domain rule: a required provider refuses every other route for its domain, and owners are exempt', async t => {
  const r = await runtime(t); const owner = await r.bootstrap(); await r.operator('member@example.com');
  // Changing domain rules needs a fresh step-up proof.
  await refused(r, await r.call('/auth/domain-rules', { method: 'POST', input: { domain: 'example.com', provider: 'okta' }, cookie: owner }), 403, 'step_up_required');
  assert.equal((await r.stepUp(owner)).status, 303);
  assert.equal((await r.call('/auth/domain-rules', { method: 'POST', input: { domain: 'example.com', provider: 'okta' }, cookie: owner })).status, 200);
  const mails = (await r.mails()).length;
  // Email link: the same public answer, naming the domain's provider, and no link is sent.
  const asked = await json(await r.call('/auth/magic-link', { method: 'POST', input: { email: 'member@example.com' } }));
  assert.deepEqual(asked, { status: 202, body: { status: 'accepted', requiredProvider: 'okta' } });
  assert.equal((await r.mails()).length, mails);
  // Another provider, and the password seam, are refused; the required provider admits.
  await refused(r, await r.login('auth', { sub: 'member-auth', email: 'member@example.com' }), 403, 'oidc_provider_required');
  await refused(r, await r.login('microsoft'), 403, 'oidc_provider_required');
  assert.equal((await json(await r.call('/test/password', { method: 'POST', input: { operatorId: 'member' } }))).body.error, 'provider_required');
  await signedIn(r, await r.login('okta'), 'member@example.com');
  // The owner, in the same domain, keeps every route.
  assert.equal((await r.call('/auth/magic-link', { method: 'POST', input: { email: 'owner@example.com' } })).status, 202);
  assert.equal((await r.mails()).length, mails + 1, 'the owner still gets an email link');
  await signedIn(r, await r.login('auth'), 'owner@example.com');
  assert.equal((await r.call('/auth/confirm', { method: 'POST', input: { token: await r.link() } })).status, 303);
  // Unlinking the provider lifts its rule so the domain is not locked out.
  assert.equal((await r.call('/auth/providers/unlink', { method: 'POST', input: { provider: 'okta' }, cookie: owner })).status, 200);
  assert.deepEqual((await json(await r.call('/auth/domain-rules', { cookie: owner }))).body, []);
});

test('with dependency support on, the owner unlinks and relinks a static provider: its sessions end, sign-in is refused, then signs in again', async t => {
  // The default seed's shape: Auth comes through the dependency link, other providers are static.
  const base = presets(), setup = { ...base, providers: base.providers.filter(p => p.id !== 'auth'), core: { dependencies: true } };
  const read = path => readFile(new URL(path, import.meta.url), 'utf8');
  const r = await runtime(t, setup, { schemas: await Promise.all(['../../../accounts/schema/operator-auth.sql', '../schema/oidc.sql', '../../../../dependencies/schema/dependencies.sql', '../../../../dependencies/schema/approval-attempt.sql', '../../../../dependencies/schema/keys-sealed.sql'].map(read)) });
  await r.db.prepare('INSERT INTO oa_auth_settings(singleton,idp_sign_in) VALUES(1,1)').run();
  const owner = await r.bootstrap();
  const google = await signedIn(r, await r.login('google'), 'owner@example.com');
  const okta = await signedIn(r, await r.login('okta', { sub: 'okta-owner', email: 'owner@example.com' }), 'owner@example.com');
  assert.equal((await r.stepUp(owner)).status, 303);
  assert.equal((await r.call('/auth/providers/unlink', { method: 'POST', input: { provider: 'google' }, cookie: owner })).status, 200);
  assert.equal((await r.call('/test/private', { cookie: google })).status, 401, 'the unlinked provider session ends');
  await refused(r, await r.call('/auth/oidc/google/start', { method: 'POST', input: { returnTo: '/app' } }), 403, 'oidc_provider_unlinked');
  assert.equal((await r.call('/test/private', { cookie: okta })).status, 200, 'another provider is untouched');
  assert.equal((await r.call('/auth/providers/relink', { method: 'POST', input: { provider: 'google' }, cookie: owner })).status, 200);
  assert.equal((await r.call('/test/private', { cookie: google })).status, 401, 'relinking does not revive the old session');
  await signedIn(r, await r.login('google'), 'owner@example.com');
});

test('step-up is demanded for each listed action and is not satisfied by a provider-issued session', async t => {
  const r = await runtime(t); const setupSession = await r.bootstrap(); await r.operator('member@example.com');
  const guarded = [
    ...STEP_UP_ACTIONS.map(action => [`/test/guard/${encodeURIComponent(action)}`, 'GET']),
    ['/auth/domain-rules', 'POST', { domain: 'example.org', provider: 'okta' }],
    ['/auth/providers/unlink', 'POST', { provider: 'google' }],
    ['/auth/providers/relink', 'POST', { provider: 'google' }],
    ['/auth/operator/role', 'POST', { operatorId: 'member', role: 'owner' }],
  ];
  const outcomes = async cookie => Promise.all(guarded.map(async ([path, method, input]) => (await r.call(path, { method, input, cookie })).status));
  const provider = await signedIn(r, await r.login('auth'), 'owner@example.com');
  await signedIn(r, await r.login('google'), 'owner@example.com');
  for (const cookie of [setupSession, provider]) {
    assert.deepEqual(await outcomes(cookie), guarded.map(() => 403), 'no fresh email-link proof');
  }
  // The proof completes only in the session that asked for it.
  assert.equal((await r.call('/auth/step-up', { method: 'POST', input: { action: 'export' }, cookie: provider })).status, 202);
  const token = await r.link();
  await refused(r, await r.call('/auth/confirm', { method: 'POST', input: { token }, cookie: setupSession }), 400);
  await refused(r, await r.call('/auth/confirm', { method: 'POST', input: { token } }), 400);
  const confirmed = await r.call('/auth/confirm', { method: 'POST', input: { token }, cookie: provider });
  assert.equal(confirmed.status, 303); assert.equal(r.session(confirmed), undefined, 'a step-up proof issues no new session');
  assert.deepEqual(await outcomes(setupSession), guarded.map(() => 403), 'another session of the same owner is still unproven');
  assert.deepEqual(await outcomes(provider), guarded.map(() => 200));
  // A fresh email-link sign-in is itself a proof; ten minutes later it is stale.
  assert.equal((await r.call('/auth/magic-link', { method: 'POST', input: { email: 'member@example.com' } })).status, 202);
  const member = r.session(await r.call('/auth/confirm', { method: 'POST', input: { token: await r.link() } }));
  assert.equal((await r.call('/test/guard/export', { cookie: member })).status, 200);
  await r.clock(11 * 60000);
  assert.equal((await r.call('/test/guard/export', { cookie: member })).status, 403);
  assert.equal((await r.call('/test/guard/export', { cookie: provider })).status, 403);
});

test('a provider failing discovery for 5 minutes, or answering 404 or a DNS failure, is hidden and the page offers the email link', async t => {
  const r = await runtime(t); await r.bootstrap();
  const buttons = async () => [...(await (await r.call('/signin')).text()).matchAll(/Continue with ([A-Za-z]+)/g)].map(m => m[1]);
  assert.deepEqual(await buttons(), ['Auth', 'Google', 'Microsoft', 'Okta']);
  await r.set('https://corp.okta.example', { failure: 'down' });
  await refused(r, await r.call('/auth/oidc/okta/start', { method: 'POST', input: {} }), 502, 'oidc_provider_unavailable');
  assert.deepEqual(await buttons(), ['Auth', 'Google', 'Microsoft', 'Okta'], 'a failure younger than 5 minutes keeps the button');
  await r.clock(5 * 60000 + 1000);
  assert.deepEqual(await buttons(), ['Auth', 'Google', 'Microsoft'], 'after 5 minutes of failure it is hidden');
  await r.set('https://id.example', { failure: '404' });
  await r.call('/auth/oidc/auth/start', { method: 'POST', input: {} });
  await r.set('https://login.microsoftonline.com/contoso.example/v2.0', { failure: 'dns' });
  await r.call('/auth/oidc/microsoft/start', { method: 'POST', input: {} });
  assert.deepEqual(await buttons(), ['Google'], '404 and DNS failures hide at once');
  // A browser that still posts to a hidden provider is sent back to the email link, not redirected away.
  const posted = await r.call('/auth/oidc/auth/start', { method: 'POST', input: { returnTo: '/app' }, form: true, headers: { Accept: 'text/html' } });
  assert.equal(posted.status, 303); assert.equal(posted.headers.get('location'), '/signin?notice=oidc_provider_unavailable');
  const page = await (await r.call(posted.headers.get('location'))).text();
  assert.match(page, /action="\/auth\/magic-link"/); assert.match(page, /role="alert"/);
  // Recovery: a later check that succeeds shows the provider again.
  await r.set('https://corp.okta.example', { failure: null });
  await r.clock(7 * 60000);
  await buttons();
  assert.ok((await buttons()).includes('Okta'));
});

test('a provider below the minimum interface version is refused and nothing is pinned', async t => {
  const r = await runtime(t); const owner = await r.bootstrap();
  await r.set('https://id.example', { rerInterfaces: ['oidc-provider@0.9.0'] });
  await refused(r, await r.call('/auth/oidc/auth/start', { method: 'POST', input: {} }), 502, 'oidc_provider_version_unsupported');
  await r.set('https://id.example', { rerInterfaces: undefined });
  await refused(r, await r.call('/auth/oidc/auth/start', { method: 'POST', input: {} }), 502, 'oidc_provider_version_unsupported');
  assert.equal((await json(await r.call('/auth/providers', { cookie: owner }))).body.some(p => p.id === 'auth'), false);
});

test('a changed IDENTITY_PROVIDER answer only starts a re-link; the owner completes it with a step-up proof', async t => {
  const r = await runtime(t); const owner = await r.bootstrap();
  await signedIn(r, await r.login('auth'), 'owner@example.com');
  await r.configure('auth', { issuer: 'https://id-next.example', clientId: 'app-at-next' });
  const start = await r.call('/auth/oidc/auth/start', { method: 'POST', input: {} });
  assert.equal(new URL(start.headers.get('location')).origin, 'https://id.example', 'sign-in still goes to the pinned provider');
  const pin = (await json(await r.call('/auth/providers', { cookie: owner }))).body.find(p => p.id === 'auth');
  assert.deepEqual([pin.issuer, pin.clientId, pin.pendingIssuer, pin.pendingClientId], ['https://id.example', 'app-at-auth', 'https://id-next.example', 'app-at-next']);
  await refused(r, await r.call('/auth/providers/relink', { method: 'POST', input: { provider: 'auth' }, cookie: owner }), 403, 'step_up_required');
  assert.equal((await r.stepUp(owner, 'providers:relink')).status, 303);
  const relinked = (await json(await r.call('/auth/providers/relink', { method: 'POST', input: { provider: 'auth' }, cookie: owner }))).body.find(p => p.id === 'auth');
  assert.deepEqual([relinked.issuer, relinked.clientId, relinked.pendingIssuer, relinked.interfaceVersion], ['https://id-next.example', 'app-at-next', null, '1.2.0']);
  await signedIn(r, await r.login('auth', { sub: 'owner-at-next' }), 'owner@example.com');
});

test('sign-in hooks: beforeMagicLink can hold a link back and afterConfirm can redirect or refuse a sign-in', async t => {
  const setup = { ...presets(), hooks: { quietFor: 'quiet@example.com', reviewFor: 'restored@example.com', refuseFor: 'forged@example.com' } };
  const r = await runtime(t, setup); await r.bootstrap();
  for (const email of ['quiet@example.com', 'restored@example.com', 'forged@example.com']) await r.operator(email);
  assert.equal((await r.call('/auth/magic-link', { method: 'POST', input: { email: 'quiet@example.com' } })).status, 202);
  assert.equal((await r.mails()).length, 0, 'the seed held this link back');
  assert.equal((await r.call('/auth/magic-link', { method: 'POST', input: { email: 'restored@example.com' } })).status, 202);
  const restored = await r.call('/auth/confirm', { method: 'POST', input: { token: await r.link() } });
  assert.equal(restored.status, 303); assert.equal(restored.headers.get('location'), '/app/review');
  assert.equal((await r.call('/auth/magic-link', { method: 'POST', input: { email: 'forged@example.com' } })).status, 202);
  await refused(r, await r.call('/auth/confirm', { method: 'POST', input: { token: await r.link() } }), 403, 'restored_operator_review');
  assert.equal((await r.db.prepare("SELECT COUNT(*) AS n FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE o.email='forged@example.com' AND s.revoked_at IS NULL").first()).n, 0);
});

test('bound subjects still need current email proof; explicit and legacy associations remain immutable', async t => {
  const setup = presets();
  setup.providers[0].subjectEmails = { mapped: 'mapped@example.com' };
  setup.core = { externalIssuers: ['https://legacy.example'] };
  setup.legacy = { issuer: 'https://legacy.example', subjectEmails: { legacy: 'legacy@example.com' } };
  const r = await runtime(t, setup); await r.bootstrap();
  for (const email of ['member@example.com', 'mapped@example.com', 'legacy@example.com']) await r.operator(email);
  const now = Math.floor(Date.now() / 1000), stale = now - 31 * day;
  const claims = { sub: 'bound', email: 'member@example.com' };
  await signedIn(r, await r.login('auth', claims), claims.email);
  const n = await sessions(r);
  for (const changed of [{ email_verified_at: stale }, { email_verified_at: null }, { email_verified: false }]) {
    await refused(r, await r.login('auth', { ...claims, ...changed }), 403);
    assert.equal(await sessions(r), n, 'no session was created');
  }
  await signedIn(r, await r.login('auth', { ...claims, email_verified_at: now - 29 * day }), claims.email);
  await refused(r, await r.login('auth', { ...claims, email: 'owner@example.com' }), 403);
  for (let i = 0; i < 2; i++) {
    await signedIn(r, await r.login('auth', { sub: 'mapped', email: 'owner@example.com', email_verified: false, email_verified_at: stale }), 'mapped@example.com');
    await signedIn(r, await r.call('/test/association', { method: 'POST', input: { issuer: 'https://legacy.example', subject: 'legacy', emailVerified: false, emailVerifiedAt: stale * 1000 } }), 'legacy@example.com');
  }
  await refused(r, await r.login('auth', { sub: 'mapped', email_verified: true, email_verified_at: stale }), 403);
  await refused(r, await r.call('/test/association', { method: 'POST', input: { issuer: 'https://legacy.example', subject: 'legacy', emailVerified: true, emailVerifiedAt: stale * 1000 } }), 403);
  // A changed configured association cannot move an existing binding.
  await r.configure('auth', { subjectEmails: { mapped: 'owner@example.com' } });
  await refused(r, await r.login('auth', { sub: 'mapped' }), 403);
  const rows = (await r.db.prepare('SELECT subject,operator_id AS operatorId FROM oa_external_identities ORDER BY subject').all()).results;
  assert.deepEqual(rows, [{ subject: 'bound', operatorId: 'member' }, { subject: 'legacy', operatorId: 'legacy' }, { subject: 'mapped', operatorId: 'mapped' }]);
});

test('Google supplied proof dates govern first and bound sign-ins; only absent dates use sign-in time', async t => {
  const r = await runtime(t); await r.bootstrap(); await r.operator('member@example.com');
  const now = Math.floor(Date.now() / 1000), claims = { sub: 'google-dated', email: 'member@example.com' };
  const bad = [now - 31 * day, now + day, null, String(now), now + 0.5, Number.MAX_SAFE_INTEGER, {}, false];
  for (const email_verified_at of bad) await refused(r, await r.login('google', { ...claims, email_verified_at }), 403);
  assert.equal(await sessions(r), 0);
  await signedIn(r, await r.login('google', { ...claims, email_verified_at: now - 29 * day }), claims.email);
  const n = await sessions(r);
  for (const email_verified_at of bad) {
    await refused(r, await r.login('google', { ...claims, email_verified_at }), 403);
    assert.equal(await sessions(r), n);
  }
  await signedIn(r, await r.login('google', claims), claims.email);
  await refused(r, await r.login('google', { ...claims, email_verified: false }), 403);
});

test('owner invitation issue and reissue require the inviting session fresh local ownership proof', async t => {
  const r = await runtime(t); await r.bootstrap();
  const owner = await signedIn(r, await r.login('auth'), 'owner@example.com');
  const invite = (email, role = 'owner') => r.call('/auth/invite', { method: 'POST', cookie: owner, input: { email, role, displayName: 'Invited' } });
  const n = await sessions(r);
  await refused(r, await invite('new-owner@example.com'), 403, 'step_up_required');
  assert.equal((await r.mails()).length, 0);
  assert.equal(await r.db.prepare("SELECT id FROM oa_operators WHERE email='new-owner@example.com'").first(), null);
  for (const role of ['member', 'admin']) assert.equal((await invite(`${role}@example.com`, role)).status, 202);
  assert.equal((await r.stepUp(owner, 'owner:transfer')).status, 303);
  assert.equal((await invite('new-owner@example.com')).status, 202);
  const obsolete = await r.link();
  assert.equal((await invite('new-owner@example.com')).status, 202, 'fresh reissue');
  await refused(r, await r.call('/auth/confirm', { method: 'POST', input: { token: obsolete } }), 400);
  const token = await r.link();
  await r.clock(11 * 60000);
  const mails = (await r.mails()).length;
  await refused(r, await invite('new-owner@example.com'), 403, 'step_up_required');
  await refused(r, await invite('other-owner@example.com'), 403, 'step_up_required');
  assert.equal((await r.mails()).length, mails, 'refusal sent no invitation');
  assert.equal(await sessions(r), n, 'invitation and proof do not mint sessions');
  // The invitation issued with local proof can still complete and become an owner.
  const response = await r.call('/auth/confirm', { method: 'POST', input: { token } });
  assert.equal(response.status, 303);
  const who = await json(await r.call('/test/private', { cookie: r.session(response) }));
  assert.deepEqual([who.status, who.body.role], [200, 'owner']);
});
