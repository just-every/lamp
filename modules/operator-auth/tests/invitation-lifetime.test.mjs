import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './runtime.mjs';

const post = (input, cookie) => ({ method: 'POST', input, cookie });
const token = async r => (await r.link()).searchParams.get('token');
const preview = (r, value) => r.call(`/auth/confirm?token=${value}`);

test('invitations outlive short sign-in and step-up links while remaining single-use, cancellable and expiring', async () => {
  const clock = { now: Date.UTC(2026, 9, 15, 12) };
  const issuedAt = clock.now;
  const r = await runtime({}, clock);
  try {
    const owner = await r.bootstrap();
    const invites = [];
    for (const name of ['alice', 'cancelled', 'unopened']) {
      assert.equal((await r.call('/auth/invite', post({ email: `${name}@example.com`, displayName: name }, owner))).status, 202);
      invites.push(await token(r));
    }
    const operators = await (await r.call('/auth/operators', { cookie: owner })).json();
    const cancelled = operators.find(operator => operator.email === 'cancelled@example.com');
    assert.equal((await r.call('/auth/invite/cancel', post({ operatorId: cancelled.id }, owner))).status, 200);
    assert.equal((await r.call('/auth/magic-link', post({ email: 'owner@example.com' }))).status, 202);
    const signIn = await token(r);
    assert.equal((await r.call('/auth/step-up', post({ action: 'export' }, owner))).status, 202);
    const stepUp = await token(r);

    clock.now += 16 * 60000;
    await r.restart();
    assert.equal((await preview(r, invites[0])).status, 200);
    const accepted = await r.call('/auth/confirm', post({ token: invites[0] }));
    assert.equal(accepted.status, 303);
    const cookie = accepted.headers.get('set-cookie').split(';')[0];
    const session = await r.call('/auth/session', { cookie });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).operator.email, 'alice@example.com');
    for (const value of [invites[0], invites[1], signIn, stepUp]) {
      assert.equal((await preview(r, value)).status, 400);
      const denied = await r.call('/auth/confirm', post({ token: value }, owner));
      assert.equal(denied.status, 400);
      assert.equal(denied.headers.get('set-cookie'), null);
    }

    clock.now = issuedAt + 7 * 86400000 - 1;
    await r.restart();
    assert.equal((await preview(r, invites[2])).status, 200);
    clock.now += 2;
    await r.restart();
    assert.equal((await preview(r, invites[2])).status, 400);
    assert.equal((await r.call('/auth/confirm', post({ token: invites[2] }))).status, 400);
  } finally { await r.close(); }
});
