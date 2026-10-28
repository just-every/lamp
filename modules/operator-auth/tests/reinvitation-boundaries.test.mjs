import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, SECRET } from './runtime.mjs';
import { AuthStore } from '../accounts/store.mjs';
import { hashToken, opaqueToken } from '../crypto.mjs';

const post = (input, cookie, extra = {}) => ({ method: 'POST', input, cookie, ...extra });
const input = (email = 'pending@example.com', role = 'member') => ({ email, role, displayName: 'Pending' });
async function cancelled(r, owner, email = 'pending@example.com', role = 'member') {
  assert.equal((await r.call('/auth/invite', post(input(email, role), owner))).status, 202);
  const operator = await (await r.db).prepare('SELECT * FROM oa_operators WHERE email=?').bind(email).first();
  assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: operator.id }, owner))).status, 200);
  return operator;
}

for (const scope of ['email', 'ip']) test(`${scope} invite budget survives cancellation, reissue and restart and stops mail before send`, async () => {
  const r = await runtime({ emailLimit: scope === 'email' ? 2 : 100, ipLimit: scope === 'ip' ? 2 : 100, limitWindowSeconds: 86400 });
  try {
    const owner = await r.bootstrap();
    const original = await cancelled(r, owner);
    const keys = async () => (await (await r.db).prepare('SELECT * FROM oa_limits ORDER BY key').all()).results;
    const before = await keys();
    await r.restart();
    assert.deepEqual(await keys(), before);
    const address = scope === 'email' ? ' PENDING@EXAMPLE.COM ' : 'pending@example.com';
    const ip = scope === 'email' ? '192.0.2.2' : '192.0.2.1';
    assert.equal((await r.call('/auth/invite', post(input(address), owner, { ip }))).status, 202);
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: original.id }, owner))).status, 200);
    await r.restart();
    const count = (await r.mails()).length;
    const target = scope === 'email' ? input('Pending@example.com') : input('another@example.com');
    const blocked = await r.call('/auth/invite', post(target, owner, { ip: scope === 'email' ? '192.0.2.3' : ip }));
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'rate_limited' });
    assert.equal((await r.mails()).length, count);
    assert.equal((await (await r.db).prepare('SELECT status FROM oa_operators WHERE id=?').bind(original.id).first()).status, 'inactive');
    assert.equal(await (await r.db).prepare("SELECT 1 FROM oa_operators WHERE email='another@example.com'").first(), null);
  } finally { await r.close(); }
});

for (const failure of ['failed', 'uncertain', 'throw']) test(`reissued invitation is revoked after ${failure} mail delivery`, async () => {
  const options = {};
  const r = await runtime({}, options);
  try {
    const owner = await r.bootstrap();
    const original = await cancelled(r, owner);
    if (failure === 'throw') options.mailThrows = true;
    else options.mailStatus = failure;
    await r.restart();
    const result = await r.call('/auth/invite', post(input(), owner));
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: 'mail_unavailable' });
    const rows = (await (await r.db).prepare('SELECT revoked_at,consumed_at FROM oa_tokens WHERE operator_id=?').bind(original.id).all()).results;
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.revoked_at !== null && row.consumed_at === null));
    assert.ok(await (await r.db).prepare('SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=?').bind(original.id).first());
    await r.restart();
    const token = (await r.link()).searchParams.get('token');
    for (const method of ['GET', 'HEAD']) assert.equal((await r.call(`/auth/confirm?token=${token}`, { method })).status, 400);
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
    assert.equal((await (await r.db).prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(original.id).first()).n, 0);
  } finally { await r.close(); }
});

test('failed witnessed-acceptance cleanup rolls back session, cancellation ledger and operator atomically', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap(), db = await r.db;
    const original = await cancelled(r, owner);
    assert.equal((await r.call('/auth/invite', post(input(), owner))).status, 202);
    const token = (await r.link()).searchParams.get('token');
    const snapshot = async () => Promise.all(['oa_operators', 'oa_invitation_cancellations', 'oa_tokens', 'oa_sessions'].map(async table => (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results));
    const before = await snapshot();
    await db.prepare("CREATE TRIGGER lifecycle_reject_acceptance BEFORE DELETE ON oa_invitation_cancellations BEGIN SELECT RAISE(ABORT,'test_storage_failure'); END").run();
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 503);
    assert.deepEqual(await snapshot(), before);
    await db.prepare('DROP TRIGGER lifecycle_reject_acceptance').run();
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 303);
    assert.equal(await db.prepare('SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=?').bind(original.id).first(), null);
  } finally { await r.close(); }
});

for (const change of ['target-role', 'target-reissued', 'actor-session-revoked', 'actor-session-expired', 'actor-version']) {
  test(`reinvitation fences stale ${change} snapshots without revoking or issuing credentials`, async () => {
    const r = await runtime();
    try {
      const owner = await r.bootstrap(), db = await r.db;
      const original = await cancelled(r, owner);
      const store = new AuthStore(db);
      const hash = await hashToken(SECRET, 'session', owner.split('=')[1]);
      const actor = { ...await store.session(hash, Date.now()), hash };
      const target = await store.operator(original.id);
      if (change === 'target-role') await db.prepare("UPDATE oa_operators SET role='admin' WHERE id=?").bind(original.id).run();
      if (change === 'target-reissued') assert.equal((await r.call('/auth/invite', post(input(), owner))).status, 202);
      if (change === 'actor-session-revoked') assert.equal((await r.call('/auth/signout', post({}, owner))).status, 204);
      if (change === 'actor-session-expired') await db.prepare('UPDATE oa_sessions SET expires_at=0 WHERE operator_id=?').bind(actor.operator.id).run();
      if (change === 'actor-version') await db.prepare('UPDATE oa_operators SET version=version+1 WHERE id=?').bind(actor.operator.id).run();
      const beforeOperator = await store.operator(original.id);
      const beforeTokens = (await db.prepare('SELECT * FROM oa_tokens ORDER BY id').all()).results;
      const issued = await store.invite({ operatorId: target.id, email: target.email, displayName: 'Pending', role: 'member', expectedVersion: target.version, reinviting: true, now: Date.now(),
        token: { id: crypto.randomUUID(), hash: await hashToken(SECRET, 'link', opaqueToken()), returnTo: '/app', expiresAt: Date.now() + 60000 } }, actor);
      assert.equal(issued, false);
      assert.deepEqual(await store.operator(original.id), beforeOperator);
      assert.deepEqual((await db.prepare('SELECT * FROM oa_tokens ORDER BY id').all()).results, beforeTokens);
    } finally { await r.close(); }
  });
}

test('reinvitation keeps role, policy, allow-list, origin and session admission boundaries', async () => {
  const options = {};
  const r = await runtime({}, options);
  try {
    const owner = await r.bootstrap();
    assert.equal((await r.call('/auth/step-up', post({ action: 'owner:transfer' }, owner))).status, 202);
    assert.equal((await r.call('/auth/confirm', post({ token: (await r.link()).searchParams.get('token') }, owner))).status, 303);
    await cancelled(r, owner, 'pending@example.com', 'owner');
    assert.equal((await r.call('/auth/invite', post(input('admin@example.com', 'admin'), owner))).status, 202);
    const joined = await r.call('/auth/confirm', post({ token: (await r.link()).searchParams.get('token') }));
    assert.equal(joined.status, 303);
    const admin = joined.headers.get('set-cookie').split(';')[0];
    const count = (await r.mails()).length;
    assert.equal((await r.call('/auth/invite', post(input(), admin))).status, 409);
    assert.equal((await r.call('/auth/invite', post(input('pending@example.com', 'owner'), admin))).status, 403);
    assert.equal((await r.call('/auth/invite', post(input('pending@example.com', 'owner')))).status, 401);
    assert.equal((await r.call('/auth/invite', post(input('pending@example.com', 'owner'), owner, { origin: 'https://attacker.test' }))).status, 403);
    assert.equal((await r.call('/auth/invite', post(input('pending@example.com', 'owner'), owner, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))).status, 403);
    r.config.allowList = ['owner@example.com', 'admin@example.com'];
    await r.restart();
    assert.equal((await r.call('/auth/invite', post(input('pending@example.com', 'owner'), owner))).status, 403);
    delete r.config.allowList;
    options.denyInvites = true;
    await r.restart();
    assert.equal((await r.call('/auth/invite', post(input('pending@example.com', 'owner'), owner))).status, 403);
    assert.equal((await r.mails()).length, count);
  } finally { await r.close(); }
});
