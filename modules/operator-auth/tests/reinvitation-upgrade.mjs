// Run explicitly with an independent old source snapshot; this is not a fixture
// imitation of old behavior and does not require history in the regular suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, post } from './reinvitation-upgrade-runtime.mjs';
const invite = async (r, owner, email) => {
  assert.equal((await r.call('/auth/invite', post({ email, displayName: 'Existing', returnTo: '/existing/history' }, owner))).status, 202);
  return { row: await (await r.db).prepare('SELECT * FROM oa_operators WHERE email=?').bind(email).first(), token: await r.link() };
};
const snapshot = async r => Promise.all(['oa_operators', 'oa_bootstrap', 'oa_tokens', 'oa_sessions', 'oa_limits'].map(async table => (await (await r.db).prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results));

test('actual baseline code and pre-cancellation schema upgrade preserves history and reopens only cancelled admissions', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    const active = await invite(r, owner, 'active@example.com');
    assert.equal((await r.call('/auth/confirm', post({ token: active.token }))).status, 303);
    const inactive = await invite(r, owner, 'inactive@example.com');
    assert.equal((await r.call('/auth/confirm', post({ token: inactive.token }))).status, 303);
    assert.equal((await r.call('/auth/operator/status', post({ operatorId: inactive.row.id, status: 'inactive' }, owner))).status, 200);
    const pending = await invite(r, owner, 'pending@example.com');
    const expired = await invite(r, owner, 'expired@example.com');
    await (await r.db).prepare('UPDATE oa_tokens SET expires_at=0 WHERE operator_id=?').bind(expired.row.id).run();
    const beforeMigration = await snapshot(r);
    await r.installCancellation();
    assert.deepEqual(await snapshot(r), beforeMigration);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: pending.row.id }, owner))).status, 200);
    assert.equal((await r.call('/auth/invite', post({ email: pending.row.email, displayName: 'Existing' }, owner))).status, 409, 'The independently sourced baseline must reproduce the old bug');
    const beforeUpgrade = await snapshot(r);
    const ledger = await (await r.db).prepare('SELECT * FROM oa_invitation_cancellations').first();
    await r.restart();
    assert.deepEqual(await snapshot(r), beforeUpgrade);
    assert.deepEqual(await (await r.db).prepare('SELECT * FROM oa_invitation_cancellations').first(), ledger);
    for (const old of [active, inactive]) assert.equal((await r.call('/auth/invite', post({ email: old.row.email, displayName: 'Existing' }, owner))).status, 409);
    const reopened = await invite(r, owner, ' PENDING@EXAMPLE.COM '.trim().toLowerCase());
    assert.equal(reopened.row.id, pending.row.id);
    assert.equal(reopened.row.created_at, pending.row.created_at);
    await r.restart();
    for (const method of ['GET', 'HEAD']) assert.equal((await r.call(`/auth/confirm?token=${pending.token}`, { method })).status, 400);
    assert.equal((await r.call('/auth/confirm', post({ token: pending.token }))).status, 400);
    const accepted = await r.call('/auth/confirm', post({ token: reopened.token }));
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), '/existing/history');
    assert.equal((await r.call('/auth/confirm', post({ token: reopened.token }))).status, 400);
    const refreshed = await invite(r, owner, expired.row.email);
    assert.equal(refreshed.row.id, expired.row.id);
    assert.equal((await r.call('/auth/confirm', post({ token: expired.token }))).status, 400);
    assert.equal((await r.call('/auth/confirm', post({ token: refreshed.token }))).status, 303);
  } finally { await r.close(); }
});
