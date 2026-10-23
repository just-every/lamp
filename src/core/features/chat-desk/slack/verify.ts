/** Authenticate the exact bytes before decoding form or JSON fields. */
export async function verifySlack(raw: string, headers: Headers, secret: string, now = Date.now()) {
  const timestamp = headers.get('x-slack-request-timestamp') ?? '';
  const signature = headers.get('x-slack-signature') ?? '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.slice(3).match(/../g)!, hex => parseInt(hex, 16));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(`v0:${timestamp}:${raw}`));
}
