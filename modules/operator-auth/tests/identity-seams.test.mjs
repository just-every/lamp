// The original server seams kept for existing callers: admitVerifiedIdentity
// and createIdentityAdmission, now admitting through the accounts adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from '../../container/adapters/d1-sqlite.mjs';
import { readFile } from 'node:fs/promises';
import { createOperatorAuth } from '../index.mjs';
import { database } from '../identity/oidc/tests/runtime.mjs';

const issuers = ['https://issuer-a.example', 'https://issuer-b.example'];
async function core(t, extra = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../accounts/schema/operator-auth.sql', import.meta.url), 'utf8'));
  sqlite.exec('INSERT INTO oa_auth_settings(singleton,idp_sign_in) VALUES(1,1)');
  t.after(() => sqlite.close());
  const auth = createOperatorAuth({ db: database(sqlite), clientIp: () => '192.0.2.1',
    config: { origin: 'https://app.example', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-only-binding-session-secret-value', SETUP_TOKEN: 'test-only-binding-setup-secret-value', externalIssuers: issuers, ...extra } });
  const request = (path = '/auth/oidc/callback') => new Request(`https://app.example${path}`, { method: 'POST', headers: { Host: 'app.example', Origin: 'https://app.example' } });
  await auth.bootstrap(request('/auth/bootstrap'), { token: 'test-only-binding-setup-secret-value', displayName: 'Owner' });
  sqlite.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('member','member@example.com','Member','member','active',?)").run(Date.now());
  const bindings = () => sqlite.prepare('SELECT issuer,subject,operator_id AS operatorId FROM oa_external_identities ORDER BY issuer,subject').all().map(row => ({ ...row }));
  return { auth, request, bindings, sqlite };
}

test('associations are immutable issuer-scoped configuration, and identity fields cannot opt into linking', async t => {
  const { auth, request, bindings } = await core(t);
  const [issuer] = issuers;
  await auth.admitVerifiedIdentity(request(), { issuer, subject: 'owner-subject', email: 'owner@example.com', emailVerified: true });
  const subjectEmails = { configured: 'member@example.com' };
  const admit = auth.createIdentityAdmission({ issuer, subjectEmails });
  subjectEmails.configured = 'owner@example.com'; subjectEmails.injected = 'owner@example.com';
  const session = await admit(request(), { issuer, subject: 'configured', email: 'owner@example.com', emailVerified: false });
  assert.equal(session.operator.id, 'member');
  await assert.rejects(admit(request(), { issuer: issuers[1], subject: 'configured' }));
  await assert.rejects(admit(request(), { issuer, subject: 'injected', email: 'owner@example.com', emailVerified: true }));
  await assert.rejects(auth.admitVerifiedIdentity(request(), { issuer, subject: 'injected', email: 'owner@example.com', emailVerified: true, associatedEmail: 'owner@example.com' }));
  for (const input of [{ issuer: 'https://unconfigured.example' }, { issuer, subjectEmails: [] }, { issuer, subjectEmails: { '': 'owner@example.com' } }, { issuer, subjectEmails: { configured: 'invalid' } }]) {
    assert.throws(() => auth.createIdentityAdmission(input), e => e.code === 'invalid_configuration');
  }
  assert.deepEqual(bindings().map(b => b.subject), ['configured', 'owner-subject']);
});

test('trusted maps never move a bound principal; token roles grant nothing; status, role versions and the allow-list still govern', async t => {
  const { auth, request, bindings, sqlite } = await core(t);
  const [issuer] = issuers;
  const staff = { issuer, subject: 'staff-subject', email: 'unverified@example.com', emailVerified: false, role: 'owner' };
  const admitted = await auth.createIdentityAdmission({ issuer, subjectEmails: { 'staff-subject': 'member@example.com' } })(request(), staff);
  assert.equal(admitted.operator.role, 'member', 'a token role never grants authority');
  const moved = auth.createIdentityAdmission({ issuer, subjectEmails: { 'staff-subject': 'owner@example.com' } });
  await assert.rejects(moved(request(), staff));
  assert.deepEqual(bindings(), [{ issuer, subject: 'staff-subject', operatorId: 'member' }]);
  sqlite.prepare("UPDATE oa_operators SET status='inactive' WHERE id='member'").run();
  await assert.rejects(auth.createIdentityAdmission({ issuer, subjectEmails: { 'staff-subject': 'member@example.com' } })(request(), staff));
  const excluded = await core(t, { allowList: ['owner@example.com'] });
  await assert.rejects(excluded.auth.createIdentityAdmission({ issuer, subjectEmails: { 'staff-subject': 'member@example.com' } })(excluded.request(), staff));
  assert.deepEqual(excluded.bindings(), []);
});
