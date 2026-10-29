export async function testKeys() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { privateKey: keys.privateKey, publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey) };
}
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
export async function signClaim(key, changes = {}, headerChanges = {}, payloadText) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 1, iss: 'https://rer.test', aud: 'https://app.test', installationId: 'installation-a', email: 'owner@example.com', jti: crypto.randomUUID(), iat: now, exp: now + 300, ...changes };
  const header = { alg: 'ES256', typ: 'rer-owner-claim+jwt', kid: 'test-v1', ...headerChanges };
  const bytes = `${encode(header)}.${encode(payloadText ?? payload)}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(bytes));
  return `${bytes}.${Buffer.from(signature).toString('base64url')}`;
}
export const claimConfig = publicKey => ({ issuer: 'https://rer.test', installationId: 'installation-a', appOrigin: 'https://app.test', expectedEmail: 'owner@example.com', publicKeys: { 'test-v1': publicKey } });
