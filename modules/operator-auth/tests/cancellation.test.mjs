import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './runtime.mjs';

const post = (input, cookie, headers) => ({ method: 'POST', input, cookie, headers });
async function invite(r, owner, email, role = 'member') {
  assert.equal((await r.call('/auth/invite', post({ email, displayName: email, role }, owner))).status, 202);
  const row = await (await r.db).prepare('SELECT * FROM oa_operators WHERE email=?').bind(email).first();
  return { row, token: (await r.link()).searchParams.get('token') };
}
async function join(r, owner, email, role) {
  const { row, token } = await invite(r, owner, email, role);
  const response = await r.call('/auth/confirm', post({ token }));
  assert.equal(response.status, 303);
  return { row, cookie: response.headers.get('set-cookie').split(';')[0] };
}
async function invalidLink(r, token) {
  for (const method of ['GET', 'HEAD']) assert.equal((await r.call(`/auth/confirm?token=${token}`, { method })).status, 400);
  const response = await r.call('/auth/confirm', post({ token }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('set-cookie'), null);
}

test('cancelInvitation invalidates all links, retains operator/history, and cannot remove the last owner', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap(), db = await r.db;
    const bootstrap = await db.prepare('SELECT * FROM oa_bootstrap').first();
    assert.equal((await r.call('/auth/step-up', post({ action: 'owner:transfer' }, owner))).status, 202);
    assert.equal((await r.call('/auth/confirm', post({ token: (await r.link()).searchParams.get('token') }, owner))).status, 303);
    const first = await invite(r, owner, 'pending@example.com', 'owner');
    const pending = await invite(r, owner, 'pending@example.com', 'owner');
    await db.prepare('CREATE TABLE test_history(id TEXT PRIMARY KEY, operator_id TEXT REFERENCES oa_operators(id))').run();
    await db.prepare('INSERT INTO test_history VALUES(?,?)').bind('recorded-invitation', pending.row.id).run();
    const response = await r.call('/auth/invite/cancel', post({ operatorId: pending.row.id }, owner));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    const cancelled = await response.json();
    assert.equal(cancelled.status, 'inactive');
    assert.equal(cancelled.version, pending.row.version + 1);
    assert.deepEqual(await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(pending.row.id).first(),
      { ...pending.row, status: 'inactive', version: pending.row.version + 1 });
    assert.deepEqual(await db.prepare('SELECT * FROM test_history').first(), { id: 'recorded-invitation', operator_id: pending.row.id });
    assert.deepEqual(await db.prepare('SELECT * FROM oa_bootstrap').first(), bootstrap);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(pending.row.id).first()).n, 0);
    await invalidLink(r, first.token);
    await invalidLink(r, pending.token);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: pending.row.id }, owner))).status, 409);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: bootstrap.claim_id }, owner))).status, 409);
    const lastOwner = await r.call('/auth/operator/status', post({ operatorId: bootstrap.claim_id, status: 'inactive' }, owner));
    assert.equal(lastOwner.status, 409);
    assert.deepEqual(await lastOwner.json(), { error: 'last_owner' });
    const activation = await r.call('/auth/operator/status', post({ operatorId: pending.row.id, status: 'active' }, owner));
    assert.equal(activation.status, 409);
    assert.deepEqual(await activation.json(), { error: 'invitation_required' });
    await invalidLink(r, pending.token);
    await db.prepare('DELETE FROM oa_tokens WHERE operator_id=?').bind(pending.row.id).run();
    await assert.rejects(db.prepare("UPDATE oa_operators SET status='active' WHERE id=?").bind(pending.row.id).run(), /invitation_required/);
    assert.equal((await r.call('/auth/operator/status', post({ operatorId: pending.row.id, status: 'active' }, owner))).status, 409);
    assert.deepEqual(await db.prepare('SELECT * FROM oa_invitation_cancellations WHERE operator_id=?').bind(pending.row.id).first(),
      { operator_id: pending.row.id, operator_version: pending.row.version + 1 });
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(pending.row.id).first()).n, 0);
  } finally { await r.close(); }
});

test('cancellation enforces HTTP origin/session and default target role policy before changing invitation authority', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    const admin = await join(r, owner, 'admin@example.com', 'admin');
    const member = await join(r, owner, 'member@example.com', 'member');
    const pending = await invite(r, owner, 'pending@example.com');
    const input = { operatorId: pending.row.id };
    assert.equal((await r.call('/auth/invite/cancel', { cookie: owner })).status, 405);
    for (const [options, status] of [[post(input), 401], [post(input, owner, { Origin: 'https://attacker.test' }), 403],
      [post(input, owner, { 'Sec-Fetch-Site': 'cross-site' }), 403], [post(input, member.cookie), 403]]) {
      assert.equal((await r.call('/auth/invite/cancel', options)).status, status);
      assert.deepEqual(await (await r.db).prepare('SELECT * FROM oa_operators WHERE id=?').bind(pending.row.id).first(), pending.row);
      assert.equal((await r.call(`/auth/confirm?token=${pending.token}`)).status, 200);
    }
    const pendingAdmin = await invite(r, owner, 'pending-admin@example.com', 'admin');
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: pendingAdmin.row.id }, admin.cookie))).status, 403);
    assert.equal((await r.call('/auth/invite/cancel', post(input, admin.cookie))).status, 200);
    assert.equal((await r.call('/auth/signout', post({}, admin.cookie))).status, 204);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: pendingAdmin.row.id }, admin.cookie))).status, 401);
    assert.equal((await r.call(`/auth/confirm?token=${pendingAdmin.token}`)).status, 200);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: 'missing' }, owner))).status, 404);
  } finally { await r.close(); }
});

test('already accepted invitations conflict without revoking their sessions or changing history', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    const member = await join(r, owner, 'joined@example.com', 'member');
    const db = await r.db;
    const before = await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(member.row.id).first();
    const response = await r.call('/auth/invite/cancel', post({ operatorId: member.row.id }, owner));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'invitation_conflict' });
    assert.deepEqual(await db.prepare('SELECT * FROM oa_operators WHERE id=?').bind(member.row.id).first(), before);
    assert.equal((await r.call('/auth/session', { cookie: member.cookie })).status, 200);
  } finally { await r.close(); }
});
