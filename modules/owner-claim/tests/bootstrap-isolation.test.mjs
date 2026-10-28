import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, setupToken } from './runtime.mjs';
import { runtime as emailRuntime } from '../../operator-auth/tests/runtime.mjs';
import { testKeys, signClaim } from './keys.mjs';

const now = 1_800_000_000_000;
const policy = { ipLimit: 3, emailLimit: 2 };
const post = (input, ip) => ({ method: 'POST', input, ip });

test('HTTP bootstrap abuse is isolated to its client while ordinary email-link limits remain shared', async t => {
  const keys = await testKeys();
  for (const path of ['/auth/bootstrap', '/auth/owner-claim']) {
    await t.test(path, async t => {
      const app = await runtime(keys.publicKey, policy, {}, { now });
      t.after(() => app.close());
      for (let attempt = 0; attempt <= policy.ipLimit; attempt++) {
        const wrong = await app.call('/auth/bootstrap', post({ token: 'wrong', displayName: 'Intruder' }, '192.0.2.10'));
        assert.ok([403, 429].includes(wrong.status));
        assert.equal(wrong.headers.get('set-cookie'), null);
        if (attempt === policy.ipLimit) assert.equal(wrong.status, 429, 'repeated wrong tokens throttle the same client');
      }
      const attacked = await app.snapshot();
      for (const table of ['oa_operators', 'oa_sessions', 'oa_bootstrap', 'oc_owner_claims']) assert.equal(attacked[table].length, 0, table);

      const token = path === '/auth/bootstrap' ? setupToken : await signClaim(keys.privateKey, { iat: now / 1000, exp: now / 1000 + 300 });
      const input = { token, displayName: 'Real Owner', returnTo: '/app' };
      const success = await app.call(path, post(input, '192.0.2.20'));
      assert.equal(success.status, 303, 'another client can claim the owner in the same frozen rate window');
      assert.equal(success.headers.get('location'), '/app');
      const cookie = success.headers.get('set-cookie').split(';')[0];
      const session = await app.call('/auth/session', { cookie });
      assert.equal(session.status, 200);
      const { operator } = await session.json();
      assert.equal(operator.email, 'owner@example.com');
      assert.equal(operator.role, 'owner');
      const claimed = await app.snapshot();
      for (const table of ['oa_operators', 'oa_sessions', 'oa_bootstrap']) assert.equal(claimed[table].length, 1, table);
      assert.equal(claimed.oc_owner_claims.length, path === '/auth/owner-claim' ? 1 : 0);

      const replay = await app.call(path, post({ ...input, displayName: 'Replacement' }, '192.0.2.30'));
      assert.equal(replay.status, 409);
      assert.equal(replay.headers.get('set-cookie'), null);
      const afterReplay = await app.snapshot();
      for (const table of ['oa_operators', 'oa_sessions', 'oa_bootstrap', 'oc_owner_claims']) assert.deepEqual(afterReplay[table], claimed[table], table);
      assert.equal((await (await app.call('/auth/session', { cookie })).json()).operator.id, operator.id);
    });
  }

  await t.test('ordinary magic-link email and IP budgets', async t => {
    const app = await emailRuntime(policy, { now });
    t.after(() => app.close());
    await app.bootstrap();
    for (const [ip, email] of [['192.0.2.40', 'OWNER@example.com'], ['192.0.2.41', 'owner@example.com']]) {
      assert.equal((await app.call('/auth/magic-link', post({ email }, ip))).status, 202);
    }
    assert.equal((await app.call('/auth/magic-link', post({ email: 'owner@example.com' }, '192.0.2.42'))).status, 429, 'one email budget spans clients');
    assert.equal((await app.mails()).length, 2);
    for (let attempt = 0; attempt <= policy.ipLimit; attempt++) {
      const result = await app.call('/auth/magic-link', post({ email: `unknown-${attempt}@example.com` }, '192.0.2.50'));
      assert.equal(result.status, attempt < policy.ipLimit ? 202 : 429, 'one client budget spans email addresses');
    }
    assert.equal((await app.mails()).length, 2, 'throttled and unknown addresses send no mail');
  });
});
