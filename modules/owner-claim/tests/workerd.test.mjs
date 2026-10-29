import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, setupToken } from './runtime.mjs';
import { testKeys, signClaim } from './keys.mjs';
const keys = await testKeys();
const mint = (payload, header) => signClaim(keys.privateKey, payload, header);
async function noWrites(app, operation, expected) {
  const before = await app.snapshot();
  const response = await operation();
  assert.equal(response.status, expected, await response.clone().text());
  assert.deepEqual(await app.snapshot(), before, 'all auth, claim and audit rows unchanged');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  return response;
}
test('real workerd + D1: GET and every invalid claim have zero durable writes; valid claim uses auth bootstrap', async t => {
  const app = await runtime(keys.publicKey); t.after(() => app.close());
  const page = await noWrites(app, () => app.call(), 200);
  const html = await page.text();
  assert.match(html, /rer-owner-claim-ready/);
  assert.match(html, /event\.source!==source/);
  assert.match(html, /event\.origin!==issuer/);
  assert.doesNotMatch(html, new RegExp(setupToken));
  assert.match(html, /owner@example.com/);
  await noWrites(app, () => app.call(undefined, { method: 'HEAD' }), 200);
  const valid = await mint();
  const now = Math.floor(Date.now() / 1000);
  const invalid = [
    [await mint({ iat: now - 301, exp: now - 1 }), 'expired'],
    [await mint({ installationId: 'installation-b' }), 'installation'],
    [await mint({ aud: 'https://another-app.test' }), 'app origin'],
    [await mint({ iss: 'https://another-rer.test' }), 'issuer'],
    [await mint({ email: 'other@example.com' }), 'email'],
    [await mint({ iat: now + 60, exp: now + 300 }), 'future issued'],
    [await mint({ iat: now, exp: now + 301 }), 'excess lifetime'],
    [await mint({}, { kid: 'unknown-key' }), 'unknown kid'],
    [`${valid.slice(0, -5)}AAAAA`, 'tampered signature'],
  ];
  for (const [token, name] of invalid) await t.test(name, () => noWrites(app, () => app.call(undefined, { method: 'POST', input: { token } }), 403));
  for (const options of [
    { origin: 'https://evil.test' }, { origin: '' }, { urlOrigin: 'https://evil.test' },
    { host: 'evil.test' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } },
  ]) await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token: valid }, ...options }), 403);
  await noWrites(app, () => app.call('/auth/owner-claim?token=forbidden'), 400);
  await noWrites(app, () => app.call('/auth/owner-claim?token=forbidden', { method: 'POST', input: { token: valid } }), 400);
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token: valid, email: 'other@example.com' } }), 400);
  await noWrites(app, () => app.call(undefined, { method: 'POST', body: `{"token":"${valid}","token":"${valid}"}`, headers: { 'Content-Type': 'application/json' } }), 400);
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token: valid }, ip: '' }), 503);
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token: valid, displayName: '' } }), 400);
  const success = await app.call(undefined, { method: 'POST', input: { token: valid, displayName: 'Real Owner', returnTo: '/app/welcome' } });
  assert.equal(success.status, 303, await success.text());
  assert.equal(success.headers.get('location'), '/app/welcome');
  assert.match(success.headers.get('set-cookie'), /^__Host-operator_session=.*; Path=\/; HttpOnly; SameSite=Lax;/);
  const session = await app.call('/auth/session', { cookie: success.headers.get('set-cookie').split(';')[0] });
  assert.equal(session.status, 200);
  const authenticated = await session.json();
  assert.equal(authenticated.operator.email, 'owner@example.com');
  assert.equal(authenticated.operator.role, 'owner');
  const state = await app.snapshot();
  assert.equal(state.oa_operators.length, 1);
  assert.equal(state.oa_sessions.length, 1);
  assert.equal(state.oa_bootstrap.length, 1);
  assert.equal(state.oc_owner_claims.length, 1);
  assert.equal(state.oc_owner_claims[0].completed, 1);
  assert.equal(state.oc_owner_claims[0].operator_id, state.oa_operators[0].id);
  assert.equal(state.oc_owner_claims[0].session_id, state.oa_sessions[0].id);
  assert.equal(state.oa_limits.length, 1);
  assert.ok(state.oa_limits.every(row => row.count === 1));
  assert.ok(!JSON.stringify(state).includes(valid));
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token: valid } }), 409);
  await app.restart();
  const fresh = await mint();
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token: fresh } }), 409);
});
test('parallel claims commit exactly one owner, session, ledger and client rate increment', async t => {
  const app = await runtime(keys.publicKey); t.after(() => app.close());
  const token = await mint();
  const other = await mint();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => app.call(undefined, { method: 'POST', input: { token: i % 2 ? token : other } })));
  assert.equal(results.filter(result => result.status === 303).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 11);
  assert.equal(results.filter(result => result.headers.has('set-cookie')).length, 1);
  const state = await app.snapshot();
  for (const table of ['oa_operators', 'oa_sessions', 'oa_bootstrap', 'oc_owner_claims']) assert.equal(state[table].length, 1, table);
  assert.equal(state.oc_owner_claims[0].completed, 1);
  assert.equal(state.oa_limits.length, 1);
  assert.ok(state.oa_limits.every(row => row.count === 1));
  assert.deepEqual(state.oa_auth_settings.map(({idp_sign_in,first_setup})=>({idp_sign_in,first_setup})),[{idp_sign_in:0,first_setup:0}]);
});
test('existing legacy owner cannot be claimed and changes no durable rows', async t => {
  const app = await runtime(keys.publicKey); t.after(() => app.close());
  const bootstrap = await app.call('/auth/bootstrap', { method: 'POST', input: { token: setupToken, displayName: 'Legacy Owner' } });
  assert.equal(bootstrap.status, 303);
  const token = await mint();
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token } }), 409);
});
test('real SQL admission failure rolls back claim, bootstrap and deferred limits', async t => {
  const app = await runtime(keys.publicKey); t.after(() => app.close());
  await app.db.prepare("CREATE TRIGGER test_refuse_session BEFORE INSERT ON oa_sessions BEGIN SELECT RAISE(ABORT,'test_session_failure'); END").run();
  const token = await mint();
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token } }), 409);
});
test('auth limiter is enforced without writes when the real existing counter is exhausted', async t => {
  const app = await runtime(keys.publicKey, { ipLimit: 1 }); t.after(() => app.close());
  const wrong = await app.call('/auth/bootstrap', { method: 'POST', input: { token: 'wrong', displayName: 'Owner' } });
  assert.equal(wrong.status, 403);
  const token = await mint();
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token } }), 429);
});
test('transaction final fence rejects actual counters exceeding policy and rolls back every write', async t => {
  const app = await runtime(keys.publicKey); t.after(() => app.close());
  // Adversarial database fixture changes the real persisted count after auth's
  // projection. The final in-transaction CHECK must abort all writes.
  await app.db.prepare('CREATE TRIGGER test_counter_race AFTER INSERT ON oa_sessions BEGIN UPDATE oa_limits SET count=1001; END').run();
  const token = await mint();
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token } }), 409);
});
test('auth allow-list refusal preserves zero writes after limiter projection', async t => {
  const app = await runtime(keys.publicKey, { allowList: ['someoneelse@example.com'] }); t.after(() => app.close());
  const token = await mint();
  await noWrites(app, () => app.call(undefined, { method: 'POST', input: { token } }), 403);
});
