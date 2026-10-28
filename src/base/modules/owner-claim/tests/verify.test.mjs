import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOwnerClaim } from '../verify.mjs';
import { testKeys, signClaim, claimConfig } from './keys.mjs';
test('strict portable ES256 verifier validates binding, lifetime, wire and rotated public keys', async () => {
  const { privateKey, publicKey } = await testKeys();
  const config = claimConfig(publicKey);
  const token = await signClaim(privateKey);
  assert.equal((await verifyOwnerClaim(token, config)).email, config.expectedEmail);
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    [{ iss: 'https://other.test' }], [{ aud: 'https://other.test' }], [{ installationId: 'installation-b' }],
    [{ email: 'other@example.com' }], [{ iat: now + 60, exp: now + 300 }], [{ iat: now - 300, exp: now }],
    [{ iat: now, exp: now + 301 }], [{ iat: 1.1 }], [{ jti: 'not-a-uuid' }], [{ extra: true }],
    [{}, { kid: 'unknown' }], [{}, { alg: 'none' }], [{}, { jku: 'https://keys.test' }], [{}, { typ: 'JWT' }],
  ];
  for (const [payload, header] of cases) await assert.rejects(verifyOwnerClaim(await signClaim(privateKey, payload, header), config));
  const raw = JSON.stringify({ v: 1, iss: config.issuer, aud: config.appOrigin, installationId: config.installationId, email: config.expectedEmail, jti: crypto.randomUUID(), iat: now, exp: now + 300 }).replace('"v":1', '"v":2,"v":1');
  await assert.rejects(verifyOwnerClaim(await signClaim(privateKey, {}, {}, raw), config));
  await assert.rejects(verifyOwnerClaim(`${token}=`, config));
  await assert.rejects(verifyOwnerClaim(token.replace(/.$/, value => value === 'A' ? 'B' : 'A'), config));
  const rotated = await testKeys();
  const next = await signClaim(rotated.privateKey, {}, { kid: 'test-v2' });
  await verifyOwnerClaim(next, { ...config, publicKeys: { ...config.publicKeys, 'test-v2': rotated.publicKey } });
  await assert.rejects(verifyOwnerClaim(token, { ...config, publicKeys: { 'test-v2': rotated.publicKey } }));
});

const fixedNow = 1_800_000_000;
for (const ahead of [1, 30, 31]) {
  test(`issuance ${ahead}s ahead of verifier clock ${ahead <= 30 ? 'is accepted' : 'is refused'}`, async () => {
    const { privateKey, publicKey } = await testKeys();
    const token = await signClaim(privateKey, { iat: fixedNow + ahead, exp: fixedNow + ahead + 300 });
    const verification = verifyOwnerClaim(token, { ...claimConfig(publicKey), now: fixedNow });
    if (ahead <= 30) assert.equal((await verification).iat, fixedNow + ahead);
    else await assert.rejects(verification, { code: 'invalid_claim', status: 403 });
  });
}

test('issuance tolerance does not relax exact expiry or the 300 second lifetime', async () => {
  const { privateKey, publicKey } = await testKeys();
  const config = { ...claimConfig(publicKey), now: fixedNow };
  const expiring = await signClaim(privateKey, { iat: fixedNow - 299, exp: fixedNow + 1 });
  assert.equal((await verifyOwnerClaim(expiring, config)).exp, fixedNow + 1);
  for (const now of [fixedNow + 1, fixedNow + 2]) {
    await assert.rejects(verifyOwnerClaim(expiring, { ...config, now }), { code: 'invalid_claim', status: 403 });
  }
  for (const iat of [fixedNow, fixedNow + 30]) {
    const excessive = await signClaim(privateKey, { iat, exp: iat + 301 });
    await assert.rejects(verifyOwnerClaim(excessive, config), { code: 'invalid_claim', status: 403 });
  }
});

test('changing payload audience or email under the original signature is refused', async () => {
  const { privateKey, publicKey } = await testKeys();
  const config = { ...claimConfig(publicKey), now: fixedNow };
  const token = await signClaim(privateKey, { iat: fixedNow, exp: fixedNow + 300 });
  await verifyOwnerClaim(token, config);
  const [header, payload, signature] = token.split('.');
  for (const [field, value, configField] of [
    ['aud', 'https://another-app.test', 'appOrigin'],
    ['email', 'another-owner@example.com', 'expectedEmail'],
  ]) {
    const changed = { ...JSON.parse(Buffer.from(payload, 'base64url')), [field]: value };
    const tampered = `${header}.${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
    await assert.rejects(verifyOwnerClaim(tampered, config), { code: 'invalid_claim', status: 403 });
    // Even a consumer configured to accept the changed binding must reject the
    // unchanged signature; the correctly re-signed control must verify.
    const acceptingConfig = { ...config, [configField]: value };
    await assert.rejects(verifyOwnerClaim(tampered, acceptingConfig), { code: 'invalid_claim', status: 403 });
    await verifyOwnerClaim(await signClaim(privateKey, changed), acceptingConfig);
  }
});
