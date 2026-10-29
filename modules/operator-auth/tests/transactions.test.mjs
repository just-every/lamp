import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, SETUP, SECRET } from './runtime.mjs';
import { AuthStore } from '../accounts/store.mjs';
import { hashToken } from '../crypto.mjs';
import { readFile } from 'node:fs/promises';
import { applySql } from './apply-sql.mjs';
const post = (input, cookie) => ({ method: 'POST', input, cookie });

test('D1 auth writes survive audit triggers and storage failures without partial authority', async () => {
  const r = await runtime({ externalIssuers: ['https://idp.example.com'] });
  try {
    const db = await r.db;
    await applySql(db, await readFile(new URL('./fixtures/trigger-writes.sql', import.meta.url), 'utf8'));
    await db.prepare("CREATE TRIGGER test_reject_session BEFORE INSERT ON oa_sessions BEGIN SELECT RAISE(ABORT,'test_storage_failure'); END").run();
    assert.equal((await r.call('/auth/bootstrap', post({ token: SETUP, displayName: 'Owner' }))).status, 503);
    for (const table of ['oa_bootstrap', 'oa_operators', 'oa_sessions']) assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0);
    await db.exec('DROP TRIGGER test_reject_session');
    const owner = await r.bootstrap();
    assert.equal((await r.call('/auth/invite', post({ email: 'invite@example.com', displayName: 'Invitee' }, owner))).status, 202);
    const token = (await r.link()).searchParams.get('token');
    await db.prepare("CREATE TRIGGER test_reject_session BEFORE INSERT ON oa_sessions BEGIN SELECT RAISE(ABORT,'test_storage_failure'); END").run();
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 503);
    assert.equal((await db.prepare("SELECT status FROM oa_operators WHERE email='invite@example.com'").first()).status, 'invited');
    assert.equal((await db.prepare('SELECT consumed_at FROM oa_tokens').first()).consumed_at, null);
    await db.exec('DROP TRIGGER test_reject_session');
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 303);
    assert.equal((await r.call('/auth/magic-link', post({ email: 'owner@example.com' }))).status, 202);
    const confirmed = await r.call('/auth/confirm', post({ token: (await r.link()).searchParams.get('token') }));
    assert.equal(confirmed.status, 303);
    const proofOwner = confirmed.headers.get('set-cookie').split(';')[0];
    assert.equal((await r.call('/auth/invite', post({ email: 'member@example.com', displayName: 'Member' }, proofOwner))).status, 202);
    const invited = (await r.link()).searchParams.get('token');
    assert.equal((await r.call('/auth/confirm', post({ token: invited }))).status, 303);
    assert.equal((await r.call('/auth/confirm', post({ token: invited }))).status, 400, 'a trigger does not permit replay');
    assert.equal((await r.call('/auth/step-up', post({ action: 'owner:transfer' }, proofOwner))).status, 202);
    assert.equal((await r.call('/auth/confirm', post({ token: (await r.link()).searchParams.get('token') }, proofOwner))).status, 303);
    const minted = await r.call('/test/credentials', post({}, proofOwner));
    assert.equal(minted.status, 201);
    const credential = await minted.json();
    assert.equal((await r.call('/test/credential-use', { headers: { Authorization: `Bearer ${credential.token}` } })).status, 200);
    assert.ok(await db.prepare("SELECT 1 FROM test_auth_writes WHERE table_name='oa_credentials' AND row_key=?").bind(credential.id).first());
    for (const idpSignIn of [true, true, false]) {
      assert.equal((await r.call('/auth/settings/identity', post({ idpSignIn }, proofOwner))).status, 200);
    }
    const audit = (await db.prepare("SELECT value FROM oa_auth_audit WHERE action='idpSignIn' ORDER BY rowid").all()).results;
    assert.deepEqual(audit.map(row => row.value), ['true', 'false'], 'unchanged settings create no audit event even with audit triggers');
    assert.equal((await r.call('/auth/email', post({ email: 'next@example.com' }, proofOwner))).status, 200);
    assert.equal((await (await r.call('/auth/session', { cookie: proofOwner })).json()).operator.email, 'next@example.com');
    const conflict = await r.call('/auth/email', post({ email: 'member@example.com' }, proofOwner));
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: 'email_in_use' });
    assert.equal((await (await r.call('/auth/session', { cookie: proofOwner })).json()).operator.email, 'next@example.com');
  } finally { await r.close(); }
});

test('an actor revoked after JS authorization cannot commit an invitation through a stale snapshot', async () => {
  const r = await runtime();
  try {
    const cookie = await r.bootstrap();
    const db = await r.db;
    const store = new AuthStore(db);
    const hash = await hashToken(SECRET, 'session', cookie.split('=')[1]);
    const snapshot = { ...await store.session(hash, Date.now()), hash };
    await db.prepare('UPDATE oa_sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(), hash).run();
    const created = await store.invite({ operatorId: crypto.randomUUID(), expectedVersion: 1, email: 'late@example.com', displayName: 'Too late', role: 'member', now: Date.now(),
      token: { id: crypto.randomUUID(), hash: 'not-a-credential', returnTo: '/app', expiresAt: Date.now() + 100000 } }, snapshot);
    assert.equal(created, false);
    assert.equal(await store.byEmail('late@example.com'), null);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_tokens').first()).n, 0);
  } finally { await r.close(); }
});

test('configuration narrowing and disabling review immediately deny preexisting credentials', async () => {
  const r = await runtime({ origin: 'http://localhost:8787', local: true, review: { enabled: true, operatorEmail: 'owner@example.com' } });
  try {
    const owner = await r.bootstrap();
    const review = await r.call('/auth/review-session', post({}));
    const reviewCookie = review.headers.get('set-cookie').split(';')[0];
    await r.call('/auth/magic-link', post({ email: 'owner@example.com' }));
    const token = (await r.link()).searchParams.get('token');
    r.config.review.enabled = false;
    await r.restart();
    assert.equal((await r.call('/auth/session', { cookie: reviewCookie })).status, 401);
    assert.equal((await r.call('/auth/session', { cookie: owner })).status, 200);
    r.config.allowList = [];
    await r.restart();
    assert.equal((await r.call('/auth/session', { cookie: owner })).status, 401);
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
    assert.equal((await r.call('/auth/confirm?token=' + token)).status, 400);
    assert.equal((await r.call('/auth/bootstrap', post({ token: SETUP, displayName: 'Owner' }))).status, 403);
  } finally { await r.close(); }
});

test('role mutation expires existing sessions and last-owner trigger protects direct SQL too', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    await r.call('/auth/invite', post({ email: 'member@example.com', displayName: 'Member' }, owner));
    const token = (await r.link()).searchParams.get('token');
    const joined = await r.call('/auth/confirm', post({ token }));
    const memberCookie = joined.headers.get('set-cookie').split(';')[0];
    const member = await (await r.call('/auth/session', { cookie: memberCookie })).json();
    assert.equal((await r.call('/auth/operator/role', post({ operatorId: member.operator.id, role: 'admin' }, owner))).status, 200);
    assert.equal((await r.call('/auth/session', { cookie: memberCookie })).status, 401);
    const db = await r.db;
    await assert.rejects(db.prepare("DELETE FROM oa_operators WHERE role='owner'").run(), /last_owner/);
    await assert.rejects(db.prepare("UPDATE oa_operators SET role='member' WHERE role='owner'").run(), /last_owner/);
    assert.equal((await r.call('/auth/session', { cookie: owner })).status, 200);
  } finally { await r.close(); }
});
