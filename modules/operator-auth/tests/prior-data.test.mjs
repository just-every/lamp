// Prior data: a populated store from the auth-1 main (Base d6080a2), produced by
// that code's own public API (fixtures/auth-1-store/README.md), runs unchanged
// under the new layers once the two additive migrations are applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runtime } from '../identity/oidc/tests/fake-runtime.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const credentials = JSON.parse(await read('./fixtures/auth-1-store/credentials.json'));
const seedMigrations = await Promise.all(credentials.migrations.map(name => read(`../../../default-seed/migrations/core/${name}`)));
const tables = ['oa_bootstrap', 'oa_dev_credentials', 'oa_external_identities', 'oa_first_run', 'oa_invitation_cancellations', 'oa_limits', 'oa_oidc_limits', 'oa_oidc_transactions', 'oa_operators', 'oa_sessions', 'oa_tokens'];
const snapshot = async db => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results])));
// The app that existed at auth-1 had one provider, the issuer its admin is bound to.
const setup = {
  core: { SESSION_SECRET: credentials.sessionSecretParts.join('-') },
  providers: [{ id: 'legacy', preset: 'okta', issuer: 'https://idp.example', clientId: 'client', tokenAuthMethod: 'client_secret_basic', clientSecret: 'fixture-secret' }],
  fakes: [{ issuer: 'https://idp.example', redirectUri: 'https://app.example/auth/oidc/legacy/callback', clientId: 'client', keyName: 'oktaSigning', claims: { sub: 'admin-subject', email: 'admin@example.com', email_verified: true } }],
};
const cookie = name => `__Host-operator_session=${credentials.sessions[name]}`;

test('a populated auth-1 store upgrades additively and every session, link, binding and guard keeps working', async t => {
  const r = await runtime(t, setup, { schemas: [...seedMigrations, await read('./fixtures/auth-1-store/rows.sql')] });
  // Run at the moment the store was written, so its links and sessions are exactly as live as they were.
  await r.clock(credentials.generatedAt + 60000 - Date.now());
  const before = await snapshot(r.db);
  for (const [table, count] of Object.entries(credentials.counts)) assert.equal(before[table].length, count, `${table} rows`);
  for (const migration of ['../accounts/schema/provider-control.sql','../accounts/schema/domain-rules-step-up.sql', '../identity/oidc/schema/oidc.sql']) {
    const applied = await r.apply(await read(migration));
    assert.equal(applied.appliedStatements, applied.statementCount);
  }
  assert.deepEqual(await snapshot(r.db), before, 'no existing row or column changed');
  const who = async name => { const response = await r.call('/test/private', { cookie: cookie(name) }); return response.status === 200 ? (await response.json()) : response.status; };
  assert.deepEqual([(await who('ownerNative')).role, (await who('adminNative')).role, (await who('memberNative')).role], ['owner', 'admin', 'member']);
  assert.equal(await who('adminOidc'),401,'old provider sessions have no provider provenance and remain off');
  assert.equal((await who('memberVerifier')).kind, 'password');
  assert.equal(await who('ownerDev'), 401, 'a dev session counts only behind the local key gate');
  assert.equal(await who('formerFenced'), 401, 'a deactivated operator stays fenced');
  assert.equal(await who('memberSignedOut'), 401, 'a signed-out session stays revoked');
  // The pending email link and invitation written by the old code complete under the new layers.
  const magic = await r.call('/auth/confirm', { method: 'POST', input: { token: credentials.links.pendingMagic } });
  assert.equal(magic.status, 303); assert.equal(magic.headers.get('location'), '/app/queue');
  const invited = await r.call('/auth/confirm', { method: 'POST', input: { token: credentials.links.pendingInvite } });
  assert.equal(invited.status, 303);
  assert.equal((await (await r.call('/test/private', { cookie: r.session(invited) })).json()).email, 'invited@example.com');
  assert.equal((await r.call('/auth/confirm', { method: 'POST', input: { token: credentials.links.devMintedInvite } })).status, 400, 'a dev-minted invitation needs the key gate');
  // The cancellation ledger still guards. A binding alone cannot replace
  // current email proof; explicit legacy configuration authorizes the same row.
  const cancelled = before.oa_operators.find(o => o.email === 'cancelled@example.com');
  assert.equal((await (await r.call('/auth/operator/status', { method: 'POST', input: { operatorId: cancelled.id, status: 'active' }, cookie: cookie('ownerNative') })).json()).error, 'invitation_required');
  assert.equal((await r.call('/auth/oidc/legacy/start',{method:'POST',input:{}})).status,403);
  assert.equal((await r.call('/auth/settings/identity',{method:'POST',input:{idpSignIn:true},cookie:cookie('ownerNative')})).status,200);
  const unproven = await r.login('legacy');
  assert.equal(unproven.status, 403);
  assert.equal(r.session(unproven), undefined);
  await r.configure('legacy', { subjectEmails: { 'admin-subject': 'admin@example.com' } });
  const admin = await r.login('legacy');
  assert.equal(admin.status, 303, await admin.clone().text());
  assert.equal((await (await r.call('/test/private', { cookie: r.session(admin) })).json()).email, 'admin@example.com');
  assert.equal((await r.db.prepare('SELECT COUNT(*) AS n FROM oa_external_identities').first()).n, 1);
  assert.equal((await r.call('/auth/operators', { cookie: cookie('adminNative') })).status, 200);
});
