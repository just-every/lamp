import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, post } from './cancellation-runtime.mjs';
import { runtime as policyRuntime } from './regression-runtime.mjs';

async function invite(r, owner, email, role = 'member') {
  assert.equal((await r.call('/auth/invite', post({ email, role, displayName: 'Pending' }, owner))).status, 202);
  return { row: await (await r.db).prepare('SELECT * FROM oa_operators WHERE email=?').bind(email).first(), token: await r.link() };
}
async function reopened(r, owner) {
  const first = await invite(r, owner, 'pending@example.com');
  assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: first.row.id }, owner))).status, 200);
  return invite(r, owner, first.row.email);
}
async function waitBarrier(r, id) {
  const deadline = Date.now() + 5000;
  while (!await (await r.db).prepare('SELECT id FROM test_barriers WHERE id=?').bind(id).first()) {
    if (Date.now() > deadline) throw new Error('Policy barrier not reached');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function release(r, id, pending) {
  if (id) await (await r.db).prepare('UPDATE test_barriers SET released=1 WHERE id=?').bind(id).run();
  if (pending) return pending;
}

for (const winner of ['cancellation', 'confirmation']) test(`reissued admission race preserves its guard when ${winner} wins`, async () => {
  const r = await runtime();
  let pending, barrier;
  try {
    const owner = await r.bootstrap();
    const target = await reopened(r, owner);
    barrier = crypto.randomUUID();
    const cancellation = post({ operatorId: target.row.id }, owner);
    const confirmation = post({ token: target.token });
    const paused = winner === 'cancellation' ? confirmation : cancellation;
    pending = r.call(winner === 'cancellation' ? '/auth/confirm' : '/auth/invite/cancel', { ...paused, headers: { 'X-Test-Policy-Barrier': barrier } });
    await waitBarrier(r, barrier);
    const committed = await r.call(winner === 'cancellation' ? '/auth/invite/cancel' : '/auth/confirm', winner === 'cancellation' ? cancellation : confirmation);
    assert.equal(committed.status, winner === 'cancellation' ? 200 : 303);
    const rejected = await release(r, barrier, pending);
    assert.equal(rejected.status, winner === 'cancellation' ? 400 : 409);
    assert.equal(rejected.headers.get('set-cookie'), null);
    const db = await r.db;
    assert.equal((await db.prepare('SELECT status FROM oa_operators WHERE id=?').bind(target.row.id).first()).status, winner === 'cancellation' ? 'inactive' : 'active');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(target.row.id).first()).n, winner === 'cancellation' ? 0 : 1);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_invitation_cancellations WHERE operator_id=?').bind(target.row.id).first()).n, winner === 'cancellation' ? 1 : 0);
  } finally { try { await release(r, barrier, pending); } finally { await r.close(); } }
});

for (const restriction of ['issuer-version', 'issuer-allow-list', 'target-allow-list', 'policy']) test(`reissued token respects ${restriction} before removing its admission guard`, async () => {
  const r = await policyRuntime();
  try {
    const owner = await r.bootstrap();
    const admin = await invite(r, owner, 'admin@example.com', 'admin');
    const joined = await r.call('/auth/confirm', post({ token: admin.token }));
    assert.equal(joined.status, 303);
    const adminCookie = joined.headers.get('set-cookie').split(';')[0];
    const target = await reopened(r, adminCookie);
    if (restriction === 'issuer-version') {
      assert.equal((await r.call('/auth/operator/role', post({ operatorId: admin.row.id, role: 'member' }, owner))).status, 200);
      assert.equal((await r.call('/auth/operator/role', post({ operatorId: admin.row.id, role: 'admin' }, owner))).status, 200);
    }
    if (restriction === 'issuer-allow-list') r.config.allowList = ['owner@example.com', target.row.email];
    if (restriction === 'target-allow-list') r.config.allowList = ['owner@example.com', admin.row.email];
    if (restriction === 'policy') r.options.policy = 'deny-invites';
    await r.restart();
    for (const method of ['GET', 'HEAD']) assert.equal((await r.call(`/auth/confirm?token=${target.token}`, { method })).status, 400);
    const response = await r.call('/auth/confirm', post({ token: target.token }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
    const db = await r.db;
    assert.ok(await db.prepare('SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=?').bind(target.row.id).first());
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(target.row.id).first()).n, 0);
    await assert.rejects(db.prepare("UPDATE oa_operators SET status='active' WHERE id=?").bind(target.row.id).run(), /invitation_required/);
  } finally { await r.close(); }
});
