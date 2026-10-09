// Copied from Base 5848e58ed6f5368cc3f8d96c9f36ecc4bf91eb6e,
// infrastructure/sendgrid-event-relay/src/crypto.ts.
// Retained locally so this standalone edition has no runtime author-repo dependency.
function timely(timestamp: string | undefined) {
  return Boolean(timestamp && /^\d+$/.test(timestamp) && Number.isSafeInteger(Number(timestamp)) && Math.abs(Date.now() - Number(timestamp) * 1000) <= 5 * 60_000);
}
function relayBytes(timestamp: string, rawBody: string) { return new TextEncoder().encode(`${timestamp}.${rawBody}`); }
async function relayKey(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}
export async function verifyRelayRequest(input: { secret: string; timestamp?: string; signature?: string; rawBody: string }): Promise<boolean> {
  if (input.secret.length < 32 || !timely(input.timestamp) || !/^v1=[a-f0-9]{64}$/.test(input.signature ?? '')) return false;
  const signature = Uint8Array.from(input.signature!.slice(3).match(/../g)!, pair => Number.parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', await relayKey(input.secret, ['verify']), signature, relayBytes(input.timestamp!, input.rawBody));
}
