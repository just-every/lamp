import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorAuth } from '../../operator-auth/index.mjs';
import { configure } from '../../operator-auth/config.mjs';
import { bootstrapTransaction } from '../transaction.mjs';
import { verifyOwnerClaim } from '../verify.mjs';
import { transactionDb } from './transaction-db.mjs';
import { testKeys, signClaim, claimConfig } from './keys.mjs';

const now = 1_800_000_000;
const authConfig = configure({ origin: 'https://app.test', OWNER_EMAIL: 'owner@example.com',
  SESSION_SECRET: 'test-session-secret-'.repeat(3), SETUP_TOKEN: 'test-setup-token-'.repeat(3) });
const request = () => new Request('https://app.test/auth/owner-claim', {
  method: 'POST', headers: { Origin: 'https://app.test', Host: 'app.test' },
});
function admission(db, claim, seconds) {
  const clock = () => seconds * 1000;
  return createOperatorAuth({ db: bootstrapTransaction(db, claim, authConfig, clock),
    config: authConfig, clock, clientIp: () => '192.0.2.1' });
}
const bootstrap = auth => auth.bootstrap(request(), { token: authConfig.SETUP_TOKEN, displayName: 'Owner' });
async function verifiedClaim(iat, exp) {
  const { privateKey, publicKey } = await testKeys();
  const token = await signClaim(privateKey, { iat, exp });
  // Verify at the issuer clock first so the transaction guard is independently
  // tested even when the consumer clock lags behind issuance.
  return verifyOwnerClaim(token, { ...claimConfig(publicKey), now: iat });
}

for (const ahead of [1, 30, 31]) {
  test(`atomic admission recheck ${ahead <= 30 ? 'accepts' : 'refuses'} issuance ${ahead}s ahead`, async t => {
    const db = transactionDb(); t.after(() => db.close());
    const claim = await verifiedClaim(now + ahead, now + ahead + 300);
    const before = db.snapshot();
    const result = bootstrap(admission(db, claim, now));
    if (ahead > 30) {
      await assert.rejects(result, { code: 'invalid_claim', status: 403 });
      assert.deepEqual(db.snapshot(), before, 'refusal writes no claim, auth or rate rows');
    } else {
      const owner = await result;
      assert.equal(owner.operator.email, claim.email);
      assert.equal(owner.operator.role, 'owner');
      const state = db.snapshot();
      assert.equal(state.oc_owner_claims[0].completed, 1);
      assert.equal(state.oc_owner_claims[0].consumed_at, now);
      assert.equal(state.oc_owner_claims[0].issued_at, now + ahead);
      assert.equal(state.oa_operators.length, 1);
      assert.equal(state.oa_sessions.length, 1);
      assert.equal(state.oa_bootstrap.length, 1);
      assert.equal(state.oa_limits.length, 1);
      assert.ok(state.oa_limits.every(row => row.count === 1));
    }
  });
}

for (const elapsed of [299, 300, 301]) {
  test(`atomic admission rechecks expiry after ${elapsed}s elapsed since verification`, async t => {
    const db = transactionDb(); t.after(() => db.close());
    const claim = await verifiedClaim(now, now + 300);
    const before = db.snapshot();
    const result = bootstrap(admission(db, claim, now + elapsed));
    if (elapsed < 300) {
      assert.equal((await result).operator.role, 'owner');
      assert.equal(db.snapshot().oc_owner_claims[0].consumed_at, now + elapsed);
    } else {
      await assert.rejects(result, { code: 'invalid_claim', status: 403 });
      assert.deepEqual(db.snapshot(), before, 'expiry at commit leaves every table unchanged');
    }
  });
}

test('atomic admission guard independently refuses a lifetime over 300 seconds', async t => {
  const db = transactionDb(); t.after(() => db.close());
  const claim = { ...await verifiedClaim(now, now + 300), exp: now + 301 };
  const before = db.snapshot();
  await assert.rejects(bootstrap(admission(db, claim, now)), { code: 'invalid_claim', status: 403 });
  assert.deepEqual(db.snapshot(), before);
});
