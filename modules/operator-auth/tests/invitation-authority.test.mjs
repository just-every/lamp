import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, post, cookie } from './regression-runtime.mjs';

async function invite(r, actor, email, role = 'member') {
  assert.equal((await r.call('/auth/invite', post({ email, role, displayName: email }, actor))).status, 202);
  return r.link();
}
async function join(r, actor, email, role) {
  const token = await invite(r, actor, email, role);
  const response = await r.call('/auth/confirm', post({ token }));
  assert.equal(response.status, 303);
  const sessionCookie = cookie(response);
  const session = await (await r.call('/auth/session', { cookie: sessionCookie })).json();
  return { cookie: sessionCookie, operator: session.operator };
}
async function unconsumed(r, email) {
  const db = await r.db;
  const operator = await db.prepare('SELECT id,status FROM oa_operators WHERE email=?').bind(email).first();
  assert.equal(operator.status, 'invited');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions WHERE operator_id=?').bind(operator.id).first()).n, 0);
  const tokens = await db.prepare('SELECT consumed_at FROM oa_tokens WHERE operator_id=?').bind(operator.id).all();
  assert.ok(tokens.results.every((row) => row.consumed_at === null));
}

for (const change of ['deactivate', 'demote']) test(`an administrator's unused invitation cannot survive issuer ${change} and restoration`, async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    const admin = await join(r, owner, 'admin@example.com', 'admin');
    const token = await invite(r, admin.cookie, 'staff@example.com');
    const stored = await (await r.db).prepare("SELECT t.issuer_id,t.issuer_version FROM oa_tokens t JOIN oa_operators o ON o.id=t.operator_id WHERE o.email='staff@example.com'").first();
    assert.deepEqual(stored, { issuer_id: admin.operator.id, issuer_version: admin.operator.version });
    assert.equal((await r.call(`/auth/confirm?token=${token}`)).status, 200);
    const path = change === 'deactivate' ? '/auth/operator/status' : '/auth/operator/role';
    const input = change === 'deactivate' ? { status: 'inactive' } : { role: 'member' };
    assert.equal((await r.call(path, post({ operatorId: admin.operator.id, ...input }, owner))).status, 200);
    for (const method of ['GET', 'HEAD']) assert.equal((await r.call(`/auth/confirm?token=${token}`, { method })).status, 400);
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
    await unconsumed(r, 'staff@example.com');
    const restore = change === 'deactivate' ? { status: 'active' } : { role: 'admin' };
    assert.equal((await r.call(path, post({ operatorId: admin.operator.id, ...restore }, owner))).status, 200);
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
    await unconsumed(r, 'staff@example.com');
    // A currently authorized operator can explicitly issue a fresh invitation.
    const fresh = await invite(r, owner, 'staff@example.com');
    assert.equal((await r.call('/auth/confirm', post({ token: fresh }))).status, 303);
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
  } finally { await r.close(); }
});

test('configured product policy can grant members admin invitations and is re-evaluated for existing links', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    const member = await join(r, owner, 'member@example.com', 'member');
    assert.equal((await r.call('/auth/invite', post({ email: 'admin@example.com', role: 'admin', displayName: 'Admin' }, member.cookie))).status, 403);
    r.options.policy = 'member-invites-admin';
    await r.restart();
    const admin = await join(r, member.cookie, 'admin@example.com', 'admin');
    assert.equal(admin.operator.role, 'admin');
    const token = await invite(r, member.cookie, 'pending-admin@example.com', 'admin');
    const ownerToken = await invite(r, owner, 'pending-member@example.com');
    r.options.policy = 'deny-invites';
    await r.restart();
    for (const value of [token, ownerToken]) {
      assert.equal((await r.call(`/auth/confirm?token=${value}`)).status, 400);
      assert.equal((await r.call('/auth/confirm', post({ token: value }))).status, 400);
    }
    await unconsumed(r, 'pending-admin@example.com');
    await unconsumed(r, 'pending-member@example.com');
    assert.equal((await r.call('/auth/session', { cookie: member.cookie })).status, 200);
    // Restore the product's authorization with unchanged operator versions.
    r.options.policy = 'member-invites-admin';
    await r.restart();
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 303);
    assert.equal((await r.call('/auth/confirm', post({ token: ownerToken }))).status, 303);
  } finally { await r.close(); }
});

test('invitation authority follows issuer admission and is independent of its issuing browser session', async () => {
  const r = await runtime();
  try {
    const owner = await r.bootstrap();
    const admin = await join(r, owner, 'admin@example.com', 'admin');
    const token = await invite(r, admin.cookie, 'staff@example.com');
    r.config.allowList = ['owner@example.com', 'staff@example.com'];
    await r.restart();
    assert.equal((await r.call(`/auth/confirm?token=${token}`)).status, 400);
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
    await unconsumed(r, 'staff@example.com');
    delete r.config.allowList;
    await r.restart();
    assert.equal((await r.call('/auth/signout', post({}, admin.cookie))).status, 204);
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 303);
  } finally { await r.close(); }
});

async function awaitBarrier(db, id) {
  const deadline = Date.now() + 5000;
  while (!await db.prepare('SELECT id FROM test_barriers WHERE id=?').bind(id).first()) {
    if (Date.now() > deadline) throw new Error('Confirmation never reached role policy');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
for (const change of ['deactivate', 'demote', 'deactivate-restore', 'demote-restore', 'none']) {
  test(`D1 redemption fences the policy snapshot while issuer changes concurrently: ${change}`, async () => {
    const r = await runtime();
    let pending;
    let barrier;
    try {
      const owner = await r.bootstrap();
      const admin = await join(r, owner, 'admin@example.com', 'admin');
      const token = await invite(r, admin.cookie, 'racing@example.com');
      const db = await r.db;
      barrier = crypto.randomUUID();
      pending = r.call('/auth/confirm', post({ token }, undefined, { 'X-Test-Pause-Policy': barrier }));
      await awaitBarrier(db, barrier);
      if (change !== 'none') {
        const status = change.startsWith('deactivate');
        const path = status ? '/auth/operator/status' : '/auth/operator/role';
        assert.equal((await r.call(path, post({ operatorId: admin.operator.id, ...(status ? { status: 'inactive' } : { role: 'member' }) }, owner))).status, 200);
        if (change.endsWith('restore')) assert.equal((await r.call(path, post({ operatorId: admin.operator.id, ...(status ? { status: 'active' } : { role: 'admin' }) }, owner))).status, 200);
      }
      await db.prepare('UPDATE test_barriers SET released=1 WHERE id=?').bind(barrier).run();
      const response = await pending;
      assert.equal(response.status, change === 'none' ? 303 : 400);
      if (change !== 'none') {
        assert.equal(response.headers.get('set-cookie'), null);
        await unconsumed(r, 'racing@example.com');
      } else {
        assert.equal((await r.call('/auth/session', { cookie: cookie(response) })).status, 200);
      }
    } finally {
      try {
        if (barrier) await (await r.db).prepare('UPDATE test_barriers SET released=1 WHERE id=?').bind(barrier).run();
        if (pending) await pending;
      } finally { await r.close(); }
    }
  });
}
