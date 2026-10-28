import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './demo-runtime.mjs';

const post = (input, cookie, headers) => ({ method: 'POST', input, cookie, headers });
const invite = { email: 'alex@example.com', displayName: 'Alex Morgan', role: 'owner' };

test('hosted demo owner claim authorizes invitations and role changes with mocked mail only in its own copy', async t => {
  const a = await runtime(t), b = await runtime(t);
  const ownerA = await a.claim(), ownerB = await b.claim();
  assert.equal((await a.call('/auth/session', { cookie: ownerA })).status, 200);
  const invited = await a.call('/auth/invite', post(invite, ownerA));
  assert.equal(invited.status, 202);
  assert.deepEqual(await invited.json(), { status: 'accepted' });
  const target = await a.db.prepare('SELECT id,role,status FROM oa_operators WHERE email=?').bind(invite.email).first();
  assert.equal(target.status, 'invited');
  const changed = await a.call('/auth/operator/role', post({ operatorId: target.id, role: 'member' }, ownerA));
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).role, 'member');
  assert.equal((await a.db.prepare('SELECT count(*) AS n FROM oa_step_up_challenges').first()).n, 0);
  for (const [visitor, foreign] of [[a, ownerB], [b, ownerA]]) {
    assert.equal((await visitor.call('/auth/invite', post(invite, foreign))).status, 401, 'another visitor cannot borrow demo proof');
  }
  assert.equal((await b.call('/auth/operators', { cookie: ownerB }).then(r => r.json())).length, 1, 'other copy has only its owner');
  assert.equal((await a.call('/auth/invite', post(invite, ownerA, { Origin: 'https://other.example.com' }))).status, 403);
  assert.equal((await a.call('/auth/signout', post({}, ownerA))).status, 204);
  assert.equal((await a.call('/auth/invite', post(invite, ownerA))).status, 401, 'revoked demo sessions cannot supply proof');
  assert.deepEqual(a.outbound, []);
  assert.deepEqual(b.outbound, []);
});

test('ordinary hosted owner still needs real step-up and cannot use a demo visitor session or request flag', async t => {
  const ordinary = await runtime(t, false), demo = await runtime(t);
  const owner = await ordinary.claim(), visitor = await demo.claim();
  for (const headers of [{}, { RER_DEMO: '1' }]) {
    const refused = await ordinary.call('/auth/invite', post(invite, owner, headers));
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: 'step_up_required' });
  }
  assert.equal((await ordinary.call('/auth/invite', post(invite, visitor))).status, 401);
  assert.equal((await ordinary.call('/auth/operators', { cookie: owner }).then(r => r.json())).length, 1);
  assert.deepEqual(ordinary.outbound, []);
});
