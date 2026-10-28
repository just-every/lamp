import assert from 'node:assert/strict';
import { post } from './pre-ledger-runtime.mjs';
import { oldCookie } from './fixtures/pre-ledger/owner-state.mjs';

export const owner = oldCookie('owner');
export const oldTables = ['oa_bootstrap', 'oa_external_identities', 'oa_limits', 'oa_oidc_limits',
  'oa_oidc_transactions', 'oa_operators', 'oa_sessions', 'oa_tokens'];
export async function snapshot(r, tables = oldTables) {
  const db = await r.db;
  return Object.fromEntries(await Promise.all(tables.map(async table =>
    [table, (await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results])));
}
export const authoritySnapshot = r => snapshot(r, ['oa_operators', 'oa_tokens', 'oa_sessions', 'oa_invitation_cancellations', 'test_mail']);
export const operator = async (r, id) => (await r.db).prepare('SELECT * FROM oa_operators WHERE id=?').bind(id).first();
export const marker = async (r, id) => (await r.db).prepare('SELECT * FROM oa_invitation_cancellations WHERE operator_id=?').bind(id).first();
export const invite = (r, name, role = 'member', returnTo = `/original/${name}?view=invitation`) =>
  r.call('/auth/invite', post({ email: `${name}@example.com`, displayName: `Reissued ${name}`, role, returnTo }, owner));
export async function error(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: code });
  assert.equal(response.headers.get('set-cookie'), null);
}
export async function session(r, cookie, id, version) {
  const response = await r.call('/auth/session', { cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.operator.id, id);
  assert.equal(body.operator.version, version);
  assert.equal(body.operator.status, 'active');
}
export async function deniedLink(r, token) {
  const before = await authoritySnapshot(r);
  for (const method of ['GET', 'HEAD']) {
    const response = await r.call(`/auth/confirm?token=${token}`, { method });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('set-cookie'), null);
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
  await error(await r.call('/auth/confirm', post({ token })), 400, 'invalid_or_expired');
  assert.deepEqual(await authoritySnapshot(r), before, 'Denied credentials cannot alter authority, mail or tokens');
}
export async function conflict(r, name, role = 'member') {
  const before = await authoritySnapshot(r);
  await error(await invite(r, name, role), 409, 'invitation_conflict');
  assert.deepEqual(await authoritySnapshot(r), before, 'Conflict preserves identities and credentials and sends no mail');
}
export async function guarded(r, id) {
  const before = await authoritySnapshot(r);
  await error(await r.call('/auth/operator/status', post({ operatorId: id, status: 'active' }, owner)), 409, 'invitation_required');
  await assert.rejects((await r.db).prepare("UPDATE oa_operators SET status='active' WHERE id=?").bind(id).run(), /invitation_required/);
  assert.deepEqual(await authoritySnapshot(r), before);
}
export async function accept(r, token, id, version, returnTo) {
  const before = await authoritySnapshot(r);
  for (const method of ['GET', 'HEAD']) {
    const response = await r.call(`/auth/confirm?token=${token}`, { method });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.deepEqual(await authoritySnapshot(r), before, 'Previews are read-only');
  const response = await r.call('/auth/confirm', post({ token, returnTo: '/must-not-override-link-destination' }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), returnTo);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  await session(r, cookie, id, version);
  assert.equal(await marker(r, id), null);
  const db = await r.db;
  const sessions = (await db.prepare('SELECT * FROM oa_sessions WHERE operator_id=?').bind(id).all()).results;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].operator_version, version);
  const consumed = await db.prepare('SELECT * FROM oa_tokens WHERE id=?').bind(sessions[0].source_token_id).first();
  assert.equal(consumed.operator_id, id);
  assert.equal(consumed.operator_version, version - 1);
  assert.equal(consumed.consumed_at, sessions[0].created_at);
  assert.equal(consumed.return_to, returnTo);
  await deniedLink(r, token);
  return cookie;
}
