import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './runtime.mjs';

const post = (input, cookie, options = {}) => ({ method: 'POST', input, cookie, ...options });
const invitation = (email = 'pending@example.com', extra = {}) => ({ email, displayName: 'Pending', ...extra });
const token = async r => (await r.link()).searchParams.get('token');
async function dead(r, value) {
  for (const method of ['GET', 'HEAD']) assert.equal((await r.call(`/auth/confirm?token=${value}`, { method })).status, 400);
  const response = await r.call('/auth/confirm', post({ token: value }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('set-cookie'), null);
}
async function guarded(r, owner, id) {
  const response = await r.call('/auth/operator/status', post({ operatorId: id, status: 'active' }, owner));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'invitation_required' });
  await assert.rejects((await r.db).prepare("UPDATE oa_operators SET status='active' WHERE id=?").bind(id).run(), /invitation_required/);
  assert.equal((await (await r.db).prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(id).first()).n, 0);
}

test('cancelled identity can receive a new invitation for the same normalized email', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    assert.equal((await r.call('/auth/invite', post(invitation(), owner))).status, 202);
    const operator = await (await r.db).prepare("SELECT * FROM oa_operators WHERE email='pending@example.com'").first();
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: operator.id }, owner))).status, 200);
    assert.equal((await r.call('/auth/invite', post(invitation('  PENDING@EXAMPLE.COM  '), owner))).status, 202);
  } finally { await r.close(); }
});

test('two cancellation cycles preserve identity/history and admission guard through reissue, pruning and restart', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    assert.equal((await r.call('/auth/invite', post(invitation(), owner))).status, 202);
    const initial = await (await r.db).prepare("SELECT * FROM oa_operators WHERE email='pending@example.com'").first();
    const bootstrap = await (await r.db).prepare('SELECT * FROM oa_bootstrap').first();
    await (await r.db).prepare('CREATE TABLE lifecycle_history(id TEXT PRIMARY KEY,operator_id TEXT REFERENCES oa_operators(id))').run();
    await (await r.db).prepare("INSERT INTO lifecycle_history VALUES('created',?)").bind(initial.id).run();
    const old = [await token(r)];
    for (let cycle = 0; cycle < 2; cycle++) {
      assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: initial.id }, owner))).status, 200);
      await guarded(r, owner, initial.id);
      await r.restart();
      for (const value of old) await dead(r, value);
      assert.equal((await r.call('/auth/invite', post(invitation(' PENDING@example.COM ', { returnTo: '/workspace?accepted=yes#inbox' }), owner))).status, 202);
      const current = await token(r);
      const pending = await (await r.db).prepare('SELECT * FROM oa_operators WHERE id=?').bind(initial.id).first();
      assert.equal(pending.status, 'invited');
      assert.equal(pending.version, initial.version + 2 * (cycle + 1));
      assert.equal(pending.created_at, initial.created_at);
      assert.equal(pending.email, initial.email);
      assert.equal((await (await r.db).prepare('SELECT count(*) AS n FROM oa_operators WHERE email=?').bind(initial.email).first()).n, 1);
      assert.ok(await (await r.db).prepare('SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=?').bind(initial.id).first());
      await guarded(r, owner, initial.id);
      await r.restart();
      for (const value of old) await dead(r, value);
      for (const method of ['GET', 'HEAD']) {
        const preview = await r.call(`/auth/confirm?token=${current}`, { method });
        assert.equal(preview.status, 200);
        assert.equal(preview.headers.get('set-cookie'), null);
      }
      old.push(current);
    }
    // Pruning credentials cannot turn a pending reissue into admission evidence.
    await (await r.db).prepare('DELETE FROM oa_tokens WHERE operator_id=?').bind(initial.id).run();
    await r.restart();
    await guarded(r, owner, initial.id);
    for (const value of old) await dead(r, value);
    assert.equal((await r.call('/auth/invite', post(invitation(undefined, { returnTo: '/workspace?accepted=yes#inbox' }), owner))).status, 202);
    const fresh = await token(r);
    await r.restart();
    const accepted = await r.call('/auth/confirm', post({ token: fresh, returnTo: '/attacker' }));
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), '/workspace?accepted=yes#inbox');
    const cookie = accepted.headers.get('set-cookie').split(';')[0];
    assert.equal((await r.call('/auth/session', { cookie })).status, 200);
    await dead(r, fresh);
    assert.equal(await (await r.db).prepare('SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=?').bind(initial.id).first(), null);
    assert.deepEqual(await (await r.db).prepare('SELECT * FROM lifecycle_history').first(), { id: 'created', operator_id: initial.id });
    assert.deepEqual(await (await r.db).prepare('SELECT * FROM oa_bootstrap').first(), bootstrap);
    assert.equal((await r.call('/auth/invite', post(invitation(), owner))).status, 409);
    assert.equal((await r.call('/auth/operator/status', post({ operatorId: initial.id, status: 'inactive' }, owner))).status, 200);
    assert.equal((await r.call('/auth/invite', post(invitation(), owner))).status, 409);
    assert.equal((await r.call('/auth/operator/status', post({ operatorId: initial.id, status: 'active' }, owner))).status, 200);
  } finally { await r.close(); }
});

test('expired and same-role pending invites resend, role conflicts do not send, and cancelled role changes need current authority', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    assert.equal((await r.call('/auth/invite', post(invitation(), owner))).status, 202);
    const first = await token(r);
    const initial = await (await r.db).prepare("SELECT * FROM oa_operators WHERE email='pending@example.com'").first();
    assert.equal((await r.call('/auth/invite', post(invitation(undefined, { role: 'admin' }), owner))).status, 409);
    assert.equal((await r.mails()).length, 1);
    assert.equal((await r.call('/auth/invite', post(invitation(), owner))).status, 202);
    await dead(r, first);
    const second = await token(r);
    await (await r.db).prepare('UPDATE oa_tokens SET expires_at=0 WHERE operator_id=?').bind(initial.id).run();
    await r.restart();
    await dead(r, second);
    assert.equal((await r.call('/auth/invite', post(invitation(), owner))).status, 202);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: initial.id }, owner))).status, 200);
    assert.equal((await r.call('/auth/invite', post(invitation(undefined, { role: 'admin' }), owner))).status, 409);
    assert.equal((await r.call('/auth/operator/role', post({ operatorId: initial.id, role: 'admin' }, owner))).status, 200);
    assert.equal((await r.call('/auth/invite', post(invitation(undefined, { role: 'admin' }), owner))).status, 202);
    await guarded(r, owner, initial.id);
    assert.equal((await r.call('/auth/confirm', post({ token: await token(r) }))).status, 303);
    const joined = await (await r.db).prepare('SELECT * FROM oa_operators WHERE id=?').bind(initial.id).first();
    assert.equal(joined.role, 'admin');
    assert.equal(joined.created_at, initial.created_at);
  } finally { await r.close(); }
});
