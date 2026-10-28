import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, post, cookie } from './cancellation-runtime.mjs';

async function invite(r, owner, email, role = 'member') {
  assert.equal((await r.call('/auth/invite', post({ email, displayName: email, role }, owner))).status, 202);
  return { operator: await (await r.db).prepare('SELECT * FROM oa_operators WHERE email=?').bind(email).first(), token: await r.link() };
}
async function join(r, owner, email, role) {
  const invited = await invite(r, owner, email, role);
  const response = await r.call('/auth/confirm', post({ token: invited.token }));
  assert.equal(response.status, 303);
  return { ...invited, cookie: cookie(response) };
}
async function awaitBarrier(db, id) {
  const deadline = Date.now() + 5000;
  while (!await db.prepare('SELECT id FROM test_barriers WHERE id=?').bind(id).first()) {
    if (Date.now() > deadline) throw new Error('Request never reached authorization');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function release(r, barrier, pending) {
  if (barrier) await (await r.db).prepare('UPDATE test_barriers SET released=1 WHERE id=?').bind(barrier).run();
  if (pending) return pending;
}

for (const winner of ['cancellation', 'confirmation']) test(`invitation race: ${winner} commits before the authorized competing request`, async () => {
  const r = await runtime();
  let pending, barrier;
  try {
    const owner = await r.bootstrap(), db = await r.db;
    const invitee = await invite(r, owner, 'racing@example.com');
    barrier = crypto.randomUUID();
    const cancellation = post({ operatorId: invitee.operator.id }, owner);
    const confirmation = post({ token: invitee.token });
    const paused = winner === 'cancellation' ? confirmation : cancellation;
    pending = r.call(winner === 'cancellation' ? '/auth/confirm' : '/auth/invite/cancel',
      { ...paused, headers: { 'X-Test-Policy-Barrier': barrier } });
    await awaitBarrier(db, barrier);
    const committed = await r.call(winner === 'cancellation' ? '/auth/invite/cancel' : '/auth/confirm', winner === 'cancellation' ? cancellation : confirmation);
    assert.equal(committed.status, winner === 'cancellation' ? 200 : 303);
    let expectedLastSignin = invitee.operator.last_signin_at;
    if (winner === 'confirmation') {
      const admitted = await db.prepare('SELECT created_at FROM oa_sessions WHERE operator_id=?').bind(invitee.operator.id).first();
      assert.ok(Number.isSafeInteger(admitted?.created_at), 'winning confirmation admits a timestamped session');
      expectedLastSignin = admitted.created_at;
    }
    const losing = await release(r, barrier, pending);
    assert.equal(losing.status, winner === 'cancellation' ? 400 : 409);
    assert.equal(losing.headers.get('set-cookie'), null);
    const operator = await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(invitee.operator.id).first();
    assert.deepEqual(operator, { ...invitee.operator, status: winner === 'cancellation' ? 'inactive' : 'active', version: invitee.operator.version + 1, last_signin_at: expectedLastSignin });
    const sessions = await db.prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(operator.id).first();
    assert.equal(sessions.n, winner === 'cancellation' ? 0 : 1);
    const token = await db.prepare('SELECT consumed_at FROM oa_tokens WHERE operator_id=?').bind(operator.id).first();
    assert.equal(token.consumed_at === null, winner === 'cancellation');
    if (winner === 'confirmation') assert.equal((await r.call('/auth/session', { cookie: cookie(committed) })).status, 200);
    assert.equal((await r.call(`/auth/confirm?token=${invitee.token}`)).status, 400);
    assert.equal((await r.call('/auth/confirm', confirmation)).status, 400);
  } finally { try { await release(r, barrier, pending); } finally { await r.close(); } }
});

for (const change of ['session-revoked', 'session-expired', 'actor-demoted', 'actor-inactive', 'actor-restored', 'target-role-changed']) {
  test(`cancellation rejects a stale authorized snapshot after ${change}`, async () => {
    const r = await runtime();
    let pending, barrier;
    try {
      const owner = await r.bootstrap(), db = await r.db;
      const admin = await join(r, owner, 'admin@example.com', 'admin');
      const invitee = await invite(r, owner, 'pending@example.com');
      barrier = crypto.randomUUID();
      pending = r.call('/auth/invite/cancel', post({ operatorId: invitee.operator.id }, admin.cookie, { 'X-Test-Policy-Barrier': barrier }));
      await awaitBarrier(db, barrier);
      if (change === 'session-revoked') assert.equal((await r.call('/auth/signout', post({}, admin.cookie))).status, 204);
      else if (change === 'session-expired') await db.prepare('UPDATE oa_sessions SET expires_at=0 WHERE operator_id=?').bind(admin.operator.id).run();
      else if (change === 'actor-demoted') assert.equal((await r.call('/auth/operator/role', post({ operatorId: admin.operator.id, role: 'member' }, owner))).status, 200);
      else if (change === 'target-role-changed') assert.equal((await r.call('/auth/operator/role', post({ operatorId: invitee.operator.id, role: 'admin' }, owner))).status, 200);
      else {
        assert.equal((await r.call('/auth/operator/status', post({ operatorId: admin.operator.id, status: 'inactive' }, owner))).status, 200);
        if (change === 'actor-restored') assert.equal((await r.call('/auth/operator/status', post({ operatorId: admin.operator.id, status: 'active' }, owner))).status, 200);
      }
      const before = await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(invitee.operator.id).first();
      const response = await release(r, barrier, pending);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'authority_changed' });
      assert.deepEqual(await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(invitee.operator.id).first(), before);
      assert.equal(before.status, 'invited');
      assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(invitee.operator.id).first()).n, 0);
      assert.equal((await db.prepare('SELECT consumed_at FROM oa_tokens WHERE operator_id=?').bind(invitee.operator.id).first()).consumed_at, null);
      // Cancellation authority changes alone must not revoke the invitation.
      assert.equal((await r.call(`/auth/confirm?token=${invitee.token}`)).status, change === 'target-role-changed' ? 400 : 200);
    } finally { try { await release(r, barrier, pending); } finally { await r.close(); } }
  });
}

test('an activation held during cancellation cannot manufacture invitation acceptance', async () => {
  const r = await runtime();
  let pending, barrier;
  try {
    const owner = await r.bootstrap(), db = await r.db;
    const invitee = await invite(r, owner, 'pending@example.com');
    barrier = crypto.randomUUID();
    pending = r.call('/auth/operator/status', post({ operatorId: invitee.operator.id, status: 'active' }, owner, { 'X-Test-Policy-Barrier': barrier }));
    await awaitBarrier(db, barrier);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: invitee.operator.id }, owner))).status, 200);
    const activation = await release(r, barrier, pending);
    assert.equal(activation.status, 409);
    assert.deepEqual(await activation.json(), { error: 'invitation_required' });
    assert.equal((await r.call('/auth/operator/status', post({ operatorId: invitee.operator.id, status: 'active' }, owner))).status, 409);
    assert.equal((await r.call('/auth/confirm', post({ token: invitee.token }))).status, 400);
    assert.equal((await db.prepare('SELECT status FROM oa_operators WHERE id=?').bind(invitee.operator.id).first()).status, 'inactive');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(invitee.operator.id).first()).n, 0);
  } finally { try { await release(r, barrier, pending); } finally { await r.close(); } }
});
