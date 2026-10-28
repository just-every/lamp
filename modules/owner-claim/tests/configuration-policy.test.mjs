import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail } from '../../operator-auth/policy.mjs';
import { configureClaim, verifyOwnerClaim } from '../verify.mjs';
import { testKeys, signClaim, claimConfig } from './keys.mjs';

const invalidConfiguration = error => error?.code === 'invalid_configuration' && error?.status === 503;

test('claim email configuration agrees with the real operator-auth policy and preserves canonical binding', async () => {
  const { privateKey, publicKey } = await testKeys();
  const config = claimConfig(publicKey);
  const accepted = [' Owner+Alias@Example.COM ', "operator.o'neill@example.test", `${'a'.repeat(242)}@example.com`];
  for (const input of accepted) {
    const expectedEmail = normalizeEmail(input);
    assert.ok(configureClaim({ ...config, expectedEmail }).expectedEmail === expectedEmail, 'canonical email must survive configuration');
    const token = await signClaim(privateKey, { email: expectedEmail });
    assert.ok((await verifyOwnerClaim(token, { ...config, expectedEmail })).email === expectedEmail, 'canonical claim must verify');
  }
  const invalid = [
    'owner<alias@example.test', 'owner>alias@example.test', 'owner@example<.test',
    'owner@example>.test', `${'a'.repeat(243)}@example.com`, 'owner @example.test',
    ...Array.from({ length: 32 }, (_, code) => `owner${String.fromCharCode(code)}alias@example.test`),
  ];
  for (const email of invalid) {
    assert.throws(() => normalizeEmail(email), error => error?.code === 'invalid_email');
    assert.throws(() => configureClaim({ ...config, expectedEmail: email }), invalidConfiguration);
  }
  for (const expectedEmail of [' Owner@example.com ', 'OWNER@example.com']) {
    assert.throws(() => configureClaim({ ...config, expectedEmail }), invalidConfiguration);
  }
});

test('public JWK configuration validates every metadata member before Web Crypto receives it', async () => {
  const { privateKey, publicKey } = await testKeys();
  const config = claimConfig(publicKey);
  const { kty, crv, x, y } = publicKey;
  const minimal = { kty, crv, x, y };
  const token = await signClaim(privateKey);
  for (const metadata of [{}, { ext: true }, { ext: false }, { kid: 'test-v1', alg: 'ES256', use: 'sig', key_ops: ['verify'], ext: false }]) {
    await verifyOwnerClaim(token, { ...config, publicKeys: { 'test-v1': { ...minimal, ...metadata } } });
  }
  const invalidMetadata = [
    ...['true', 1, 0, null, [], {}, undefined].map(ext => ({ ext })),
    ...['verify', { 0: 'verify', length: 1 }, [], ['sign'], ['verify', 'verify'], null, undefined].map(key_ops => ({ key_ops })),
    ...['different', 1, null, undefined].map(kid => ({ kid })),
    ...['HS256', [], null, undefined].map(alg => ({ alg })),
    ...['enc', {}, null, undefined].map(use => ({ use })),
    { d: 'private-material-is-forbidden' }, { unknown: true }, { x5u: 'https://keys.example.test' },
    { x: 'a'.repeat(43) }, { y: 'coordinate' },
  ];
  for (const metadata of invalidMetadata) {
    assert.throws(() => configureClaim({ ...config, publicKeys: { 'test-v1': { ...minimal, ...metadata } } }), invalidConfiguration);
  }
});
