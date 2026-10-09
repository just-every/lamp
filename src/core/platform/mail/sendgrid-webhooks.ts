function decode(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
// SendGrid signs ASN.1 DER ECDSA; WebCrypto expects the fixed-width r || s form.
function rawSignature(der: Uint8Array) {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error('Invalid signature');
  let cursor = 2;
  const raw = new Uint8Array(64);
  for (const offset of [0, 32]) {
    if (der[cursor++] !== 2) throw new Error('Invalid integer');
    const length = der[cursor++];
    let value = der.slice(cursor, cursor + length); cursor += length;
    if (value.length === 33 && value[0] === 0) value = value.slice(1);
    if (!value.length || value.length > 32) throw new Error('Invalid integer size');
    raw.set(value, offset + 32 - value.length);
  }
  if (cursor !== der.length) throw new Error('Invalid signature length');
  return raw;
}
export async function verifySendGridWebhook(input: { publicKey: string; timestamp?: string; signature?: string; rawBody: string }) {
  if (!input.timestamp || !/^\d+$/.test(input.timestamp) || !input.signature || Math.abs(Date.now() - Number(input.timestamp) * 1000) > 5 * 60_000) return false;
  try {
    const key = await crypto.subtle.importKey('spki', decode(input.publicKey).buffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, rawSignature(decode(input.signature)).buffer, new TextEncoder().encode(input.timestamp + input.rawBody));
  } catch { return false; }
}
