import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runtime, post } from './cancellation-runtime.mjs';
import { applySql } from './apply-sql.mjs';

async function snapshot(db) {
  return Promise.all(['oa_operators', 'oa_bootstrap', 'oa_tokens', 'oa_sessions'].map(async table => (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results));
}
async function invitation(r, owner) {
  assert.equal((await r.call('/auth/invite', post({ email: 'pending@example.com', displayName: 'Pending' }, owner))).status, 202);
  return { operator: await (await r.db).prepare("SELECT * FROM oa_operators WHERE email='pending@example.com'").first(), token: await r.link() };
}

test('additive cancellation migration preserves existing operators and credentials and survives restart/credential pruning', async () => {
  const r = await runtime({ existingStore: true });
  try {
    const owner = await r.bootstrap(), db = await r.db;
    const pending = await invitation(r, owner);
    const before = await snapshot(db);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: pending.operator.id }, owner))).status, 503);
    assert.deepEqual(await snapshot(db), before, 'Missing ledger must prevent cancellation, not silently omit reactivation protection');
    const migration = await readFile(new URL('../accounts/schema/invitation-cancellation.sql', import.meta.url), 'utf8');
    assert.equal(await readFile(new URL('../../../default-seed/migrations/core/0003_invitation_cancellation.sql', import.meta.url), 'utf8'), migration);
    assert.ok((await readFile(new URL('../accounts/schema/operator-auth.sql', import.meta.url), 'utf8')).includes(migration));
    await applySql(db, migration);
    // The rest of the upgrade to this runtime: the dev-sessions rebuild.
    await applySql(db, await readFile(new URL('../accounts/schema/dev-sessions.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await snapshot(db), before);
    assert.equal((await r.call('/auth/session', { cookie: owner })).status, 200);
    assert.equal((await r.call(`/auth/confirm?token=${pending.token}`)).status, 200);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: pending.operator.id }, owner))).status, 200);
    await db.prepare('DELETE FROM oa_tokens WHERE operator_id=?').bind(pending.operator.id).run();
    await r.restart();
    const restored = await r.db;
    const response = await r.call('/auth/operator/status', post({ operatorId: pending.operator.id, status: 'active' }, owner));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'invitation_required' });
    await assert.rejects(restored.prepare("UPDATE oa_operators SET status='active' WHERE id=?").bind(pending.operator.id).run(), /invitation_required/);
    assert.equal((await restored.prepare('SELECT status FROM oa_operators WHERE id=?').bind(pending.operator.id).first()).status, 'inactive');
    assert.equal((await r.call('/auth/confirm', post({ token: pending.token }))).status, 400);
    assert.deepEqual((await snapshot(restored))[1], before[1], 'The bootstrap ledger is retained');
  } finally { await r.close(); }
});

test('a failed durable cancellation write rolls back status and authority version in real D1', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap(), db = await r.db;
    const pending = await invitation(r, owner);
    const before = await snapshot(db);
    await db.prepare("CREATE TRIGGER test_reject_cancellation BEFORE INSERT ON oa_invitation_cancellations BEGIN SELECT RAISE(ABORT,'test_storage_failure'); END").run();
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: pending.operator.id }, owner))).status, 503);
    assert.deepEqual(await snapshot(db), before);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_invitation_cancellations').first()).n, 0);
    assert.equal((await r.call(`/auth/confirm?token=${pending.token}`)).status, 200);
    await db.prepare('DROP TRIGGER test_reject_cancellation').run();
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: pending.operator.id }, owner))).status, 200);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_invitation_cancellations').first()).n, 1);
  } finally { await r.close(); }
});
