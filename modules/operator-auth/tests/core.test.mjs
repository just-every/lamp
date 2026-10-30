import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime, SETUP } from './runtime.mjs';
const post = (input, cookie, extra = {}) => ({ method: 'POST', input, cookie, ...extra });
const cookie = (response) => response.headers.get('set-cookie')?.split(';')[0];
async function issue(r, email = 'owner@example.com', returnTo = '/app') {
  const response = await r.call('/auth/magic-link', post({ email, returnTo }));
  assert.equal(response.status, 202, await response.text());
  return (await r.link()).searchParams.get('token');
}
async function invite(r, ownerCookie, email, role = 'member') {
  const response = await r.call('/auth/invite', post({ email, role, displayName: email }, ownerCookie));
  assert.equal(response.status, 202, await response.text());
  const token = (await r.link()).searchParams.get('token');
  const confirmed = await r.call('/auth/confirm', post({ token }));
  assert.equal(confirmed.status, 303, await confirmed.text());
  return cookie(confirmed);
}
// A step-up proof: the email link sent to the signed-in operator, confirmed in the same session.
async function stepUp(r, value, action = 'owner:transfer') {
  assert.equal((await r.call('/auth/step-up', post({ action }, value))).status, 202);
  assert.equal((await r.call('/auth/confirm', post({ token: (await r.link()).searchParams.get('token') }, value))).status, 303);
}
async function session(r, value) { const response = await r.call('/auth/session', { cookie: value }); assert.equal(response.status, 200); return response.json(); }

test('fresh real D1 bootstrap is mail-independent, one owner/session, atomic across race and restart', async () => {
  const r = await runtime({}, { noMail: true });
  try {
    const invalid = await r.call('/auth/bootstrap', post({ token: 'wrong', displayName: 'Owner' }));
    assert.equal(invalid.status, 403);
    const results = await Promise.all(Array.from({ length: 8 }, () => r.call('/auth/bootstrap', post({ token: SETUP, displayName: 'First owner', returnTo: '//evil.test' }))));
    assert.equal(results.filter((v) => v.status === 303).length, 1);
    assert.deepEqual(results.filter((v) => v.status !== 303).map((v) => v.status), Array(7).fill(409));
    const response = results.find((v) => v.status === 303);
    assert.equal(response.headers.get('location'), '/app');
    assert.match(response.headers.get('set-cookie'), /^__Host-operator_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    const current = await session(r, cookie(response));
    assert.equal(current.operator.role, 'owner');
    assert.equal(current.operator.email, 'owner@example.com');
    const db = await r.db;
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_operators').first()).n, 1);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions').first()).n, 1);
    assert.deepEqual(await r.mails(), []);
    await r.restart();
    assert.equal((await r.call('/auth/session', { cookie: cookie(response) })).status, 200);
    assert.equal((await r.call('/auth/bootstrap', post({ token: SETUP, displayName: 'Again' }))).status, 409);
  } finally { await r.close(); }
});

test('scanner GET/HEAD do not consume; same-origin POST wins once, preserves returnTo, and replay fails', async () => {
  const r = await runtime();
  try {
    await r.bootstrap();
    const token = await issue(r, ' OWNER@EXAMPLE.COM ', '/app/queue?state=open#latest');
    const link = `/auth/confirm?token=${token}`;
    for (const method of ['GET', 'HEAD', 'GET']) {
      const res = await r.call(link, { method });
      assert.equal(res.status, 200); assert.equal(res.headers.get('set-cookie'), null);
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin');
    }
    const db = await r.db;
    assert.equal((await db.prepare('SELECT consumed_at FROM oa_tokens').first()).consumed_at, null);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions').first()).n, 1);
    assert.equal((await r.call('/auth/confirm', post({ token }, undefined, { origin: 'https://evil.test' }))).status, 403);
    const results = await Promise.all(Array.from({ length: 12 }, () => r.call('/auth/confirm', post({ token }))));
    assert.equal(results.filter((v) => v.status === 303).length, 1);
    assert.equal(results.filter((v) => v.status === 400).length, 11);
    const accepted = results.find((v) => v.status === 303);
    assert.equal(accepted.headers.get('location'), '/app/queue?state=open#latest');
    const c = cookie(accepted);
    assert.equal((await r.call('/private/known', { cookie: c })).status, 200);
    assert.equal((await r.call('/private/unknown', { cookie: c })).status, 404);
    for (const path of ['/private/known', '/private/unknown']) assert.equal((await r.call(path)).status, 401);
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM oa_sessions').first()).n, 2);
    const stored = await db.prepare('SELECT token_hash FROM oa_tokens').first();
    assert.notEqual(stored.token_hash, token); assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
  } finally { await r.close(); }
});

test('expiry, duplicate cookies, missing cookie and revocation deny both known and unknown private paths', async () => {
  const r = await runtime();
  try {
    const first = await r.bootstrap();
    const token = await issue(r);
    const db = await r.db;
    await db.prepare('UPDATE oa_tokens SET expires_at=?').bind(Date.now() - 1000).run();
    assert.equal((await r.call('/auth/confirm', post({ token }))).status, 400);
    assert.equal((await r.call('/auth/session', { cookie: `${first}; ${first}` })).status, 401);
    const freshToken = await issue(r);
    const second = cookie(await r.call('/auth/confirm', post({ token: freshToken })));
    const one = await session(r, first);
    assert.equal((await r.call('/auth/session/revoke', post({ sessionId: one.id }, second))).status, 204);
    for (const path of ['/private/known', '/private/unknown']) assert.equal((await r.call(path, { cookie: first })).status, 401);
    const secondSession = await session(r, second);
    await db.prepare('UPDATE oa_sessions SET expires_at=? WHERE id=?').bind(Date.now() - 1, secondSession.id).run();
    for (const path of ['/private/known', '/private/unknown']) assert.equal((await r.call(path, { cookie: second })).status, 401);
  } finally { await r.close(); }
});

test('durable IP and normalized email limits are independent, atomic, and persist on restart', async () => {
  const r = await runtime({ ipLimit: 3, emailLimit: 2 });
  try {
    await r.bootstrap();
    const requests = await Promise.all(['A@EXAMPLE.COM', 'a@example.com', ' a@example.com '].map((email, index) => r.call('/auth/magic-link', post({ email }, undefined, { ip: `192.0.2.${index + 10}` }))));
    assert.equal(requests.filter((v) => v.status === 202).length, 2);
    assert.equal(requests.filter((v) => v.status === 429).length, 1);
    const ips = await Promise.all(Array.from({ length: 4 }, (_, i) => r.call('/auth/magic-link', post({ email: `person${i}@example.com` }, undefined, { ip: '192.0.2.99' }))));
    assert.equal(ips.filter((v) => v.status === 202).length, 3);
    assert.equal(ips.filter((v) => v.status === 429).length, 1);
    await r.restart();
    assert.equal((await r.call('/auth/magic-link', post({ email: 'a@example.com' }, undefined, { ip: '192.0.2.200' }))).status, 429);
    assert.deepEqual(await r.mails(), []);
    const rows = await (await r.db).prepare('SELECT key FROM oa_limits').all();
    assert.ok(rows.results.every((v) => /^[0-9a-f]{64}$/.test(v.key)));
  } finally { await r.close(); }
});

test('allow-list filters issuance, confirmation, and existing-session admission', async () => {
  const r = await runtime({ allowList: ['owner@example.com'] });
  try {
    const owner = await r.bootstrap();
    assert.equal((await r.call('/auth/invite', post({ email: 'other@example.com', displayName: 'Other' }, owner))).status, 403);
    assert.equal((await r.call('/auth/magic-link', post({ email: 'other@example.com' }))).status, 202);
    assert.deepEqual(await r.mails(), []);
    assert.equal((await r.call('/auth/magic-link', post({ email: 'owner@example.com' }))).status, 202);
    assert.equal((await r.mails()).length, 1);
  } finally { await r.close(); }
});

test('invitation acceptance, default role policy, deactivate/reactivate, session metadata and final owner invariants', async () => {
  const r = await runtime();
  try {
    const ownerCookie = await r.bootstrap();
    const owner = await session(r, ownerCookie);
    const memberCookie = await invite(r, ownerCookie, 'member@example.com');
    const member = await session(r, memberCookie);
    const adminCookie = await invite(r, ownerCookie, 'admin@example.com', 'admin');
    assert.equal((await r.call('/auth/operators', { cookie: memberCookie })).status, 403);
    assert.equal((await r.call('/auth/invite', post({ email: 'owner2@example.com', displayName: 'Other owner', role: 'owner' }, adminCookie))).status, 403);
    assert.equal((await r.call('/auth/operator/status', post({ operatorId: owner.operator.id, status: 'inactive' }, adminCookie))).status, 403);
    const ownList = await r.call('/auth/sessions', { cookie: memberCookie });
    assert.equal(ownList.status, 200);
    assert.ok((await ownList.json()).every((v) => v.active && !('token_hash' in v) && !('hash' in v)));
    assert.equal((await r.call(`/auth/sessions?operatorId=${owner.operator.id}`, { cookie: memberCookie })).status, 403);
    const outstanding = await issue(r, 'member@example.com');
    assert.equal((await r.call('/auth/operator/status', post({ operatorId: member.operator.id, status: 'inactive' }, adminCookie))).status, 200);
    assert.equal((await r.call('/auth/session', { cookie: memberCookie })).status, 401);
    assert.equal((await r.call('/auth/confirm', post({ token: outstanding }))).status, 400);
    assert.equal((await r.call('/auth/operator/status', post({ operatorId: member.operator.id, status: 'active' }, adminCookie))).status, 200);
    assert.equal((await r.call('/auth/session', { cookie: memberCookie })).status, 401);
    assert.equal((await r.call('/auth/confirm', post({ token: outstanding }))).status, 400);
    const fresh = await issue(r, 'member@example.com');
    assert.equal((await r.call('/auth/confirm', post({ token: fresh }))).status, 303);
    const lastOwner = await r.call('/auth/operator/status', post({ operatorId: owner.operator.id, status: 'inactive' }, ownerCookie));
    assert.equal(lastOwner.status, 403); assert.equal((await lastOwner.json()).error, 'step_up_required');
    assert.equal((await r.call('/auth/operator/role', post({ operatorId: owner.operator.id, role: 'member' }, ownerCookie))).status, 403, 'unmaking an owner needs a fresh step-up proof');
    await stepUp(r, ownerCookie);
    const provenLastOwner = await r.call('/auth/operator/status', post({ operatorId: owner.operator.id, status: 'inactive' }, ownerCookie));
    assert.equal(provenLastOwner.status, 409); assert.equal((await provenLastOwner.json()).error, 'last_owner');
    assert.equal((await r.call('/auth/operator/role', post({ operatorId: owner.operator.id, role: 'member' }, ownerCookie))).status, 409);
    const logout = await r.call('/auth/signout', post({}, adminCookie));
    assert.equal(logout.status, 204); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await r.call('/auth/operators', { cookie: adminCookie })).status, 401);
  } finally { await r.close(); }
});

test('invitation retries invalidate older links; role changes and competing owner deactivation preserve one active owner', async () => {
  const r = await runtime();
  try {
    const first = await r.bootstrap();
    const owner = await session(r, first);
    const payload = { email: 'second@example.com', displayName: 'Second', role: 'owner' };
    await stepUp(r, first);
    assert.equal((await r.call('/auth/invite', post(payload, first))).status, 202);
    const obsolete = (await r.link()).searchParams.get('token');
    assert.equal((await r.call('/auth/invite', post(payload, first))).status, 202);
    assert.equal((await r.call('/auth/confirm', post({ token: obsolete }))).status, 400);
    const token = (await r.link()).searchParams.get('token');
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => r.call('/auth/confirm', post({ token }))));
    assert.equal(concurrent.filter((v) => v.status === 303).length, 1);
    const second = cookie(concurrent.find((v) => v.status === 303));
    const other = await session(r, second);
    const deactivated = await Promise.all([
      r.call('/auth/operator/status', post({ operatorId: owner.operator.id, status: 'inactive' }, first)),
      r.call('/auth/operator/status', post({ operatorId: other.operator.id, status: 'inactive' }, second)),
    ]);
    assert.equal(deactivated.filter((v) => v.status === 200).length, 1);
    assert.equal(deactivated.filter((v) => v.status === 409).length, 1);
    assert.equal((await (await r.db).prepare("SELECT count(*) AS n FROM oa_operators WHERE role='owner' AND status='active'").first()).n, 1);
  } finally { await r.close(); }
});

test('mail failures revoke outstanding credentials; unavailable mail is never silently replaced', async () => {
  for (const options of [{ noMail: true }, { mailStatus: 'uncertain' }, { mailThrows: true }, { mailStatus: 'development' }]) {
    const r = await runtime({}, options);
    try {
      await r.bootstrap();
      assert.equal((await r.call('/auth/magic-link', post({ email: 'owner@example.com' }))).status, 503);
      const rows = await (await r.db).prepare('SELECT revoked_at FROM oa_tokens').all();
      assert.ok(rows.results.every((v) => v.revoked_at !== null));
    } finally { await r.close(); }
  }
});

test('review issuance/admission enforce literal loopback Host independent of forwarded headers', async () => {
  const r = await runtime({ origin: 'http://localhost:8787', local: true, review: { enabled: true, operatorEmail: 'owner@example.com' } });
  try {
    assert.equal((await r.call('/auth/review-session', post({}))).status, 403); // no fixture owner
    await r.bootstrap();
    for (const host of ['evil.test', 'localhost.evil.test', '127.0.0.2:8787']) {
      const bad = await r.call('/auth/review-session', post({}, undefined, { host, headers: { 'X-Forwarded-Host': 'localhost:8787', Forwarded: 'host=localhost:8787' } }));
      assert.equal(bad.status, 403);
    }
    const valid = await r.call('/auth/review-session', post({ returnTo: '/app/review' }));
    assert.equal(valid.status, 303);
    const c = cookie(valid); assert.match(c, /^operator_session_local_8787=/);
    assert.equal((await session(r, c)).kind, 'review');
    assert.equal((await r.call('/auth/session', { cookie: c, host: 'evil.test', headers: { 'X-Forwarded-Host': 'localhost:8787' } })).status, 403);
    assert.equal((await r.call('/auth/session', { cookie: c })).status, 200);
  } finally { await r.close(); }
});

test('trusted external and password seams share native policy and subject binding; custom policy restricts management', async () => {
  const r = await runtime({ externalIssuers: ['https://idp.example.com'] });
  try {
    const ownerCookie = await r.bootstrap();
    const memberCookie = await invite(r, ownerCookie, 'member@example.com');
    const member = await session(r, memberCookie);
    const identity = { issuer: 'https://idp.example.com', subject: 'subject-one', email: 'member@example.com', emailVerified: true };
    assert.equal((await r.call('/test/external', post({ identity }))).status, 403, 'provider sign-in starts off');
    assert.equal((await r.call('/auth/settings/identity', post({ idpSignIn: true }, ownerCookie))).status, 200);
    for (const patch of [{ emailVerified: false }, { issuer: 'https://evil.test' }, { email: 'uninvited@example.com' }]) assert.equal((await r.call('/test/external', post({ identity: { ...identity, ...patch } }))).status, 403);
    const password = await r.call('/test/password', post({ operatorId: member.operator.id }));
    assert.equal(password.status, 200);
    assert.equal((await session(r, cookie(password))).kind, 'password');
    const external = await r.call('/test/external', post({ identity }));
    assert.equal(external.status, 200);
    assert.equal((await session(r, cookie(external))).kind, 'oidc');
    // Binding a provider principal revokes the operator's earlier password credentials.
    assert.equal((await r.call('/auth/session', { cookie: cookie(password) })).status, 401);
    assert.deepEqual(await (await r.call('/test/password', post({ operatorId: member.operator.id }))).json(), { error: 'password_revoked' });
    // A bound principal never moves to another existing account.
    assert.equal((await r.call('/test/external', post({ identity: { ...identity, email: 'owner@example.com' } }))).status, 403);
    await r.call('/auth/operator/status', post({ operatorId: member.operator.id, status: 'inactive' }, ownerCookie));
    assert.equal((await r.call('/test/password', post({ operatorId: member.operator.id }))).status, 403);
    assert.equal((await r.call('/test/external', post({ identity }))).status, 403);
    assert.equal((await r.call('/auth/session', { cookie: cookie(external) })).status, 401);
  } finally { await r.close(); }
  const variation = await runtime({}, { denyInvites: true });
  try {
    const owner = await variation.bootstrap();
    assert.equal((await variation.call('/auth/invite', post({ email: 'staff@example.com', displayName: 'Staff' }, owner))).status, 403);
    assert.equal((await variation.call('/auth/operators', { cookie: owner })).status, 200);
  } finally { await variation.close(); }
});
