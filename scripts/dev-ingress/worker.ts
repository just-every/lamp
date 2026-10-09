import { proofHeader, proofPayload } from './protocol.mjs';

/** Only a proof made after inspecting the original socket headers authorizes
 * removal of the one X-Forwarded-Host field Cloudflare's Vite plugin adds.
 * The ordinary outbox predicate still checks the resulting actual Request. */
export function createDevelopmentAuthenticator(secret: string) {
  const used = new Map<string, number>();
  const maxAge = 5 * 60_000;
  const key = crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g)!, byte => parseInt(byte, 16)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return async (request: Request): Promise<Request | null> => {
    const proof = request.headers.get(proofHeader);
    if (!proof || !/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(proof)) return null;
    const [issued, nonce, mac] = proof.split('.');
    const now = Date.now();
    if (Number(issued) > now || now - Number(issued) > maxAge) return null;
    const host = request.headers.get('host');
    if (!host || request.headers.get('x-forwarded-host') !== host) return null;
    const payload = proofPayload(request.method, request.url, host, request.headers.get('origin'), request.headers.get('sec-fetch-site'), `${issued}.${nonce}`);
    const signature = Uint8Array.from(mac.match(/../g)!, byte => parseInt(byte, 16));
    if (!await crypto.subtle.verify('HMAC', await key, signature, new TextEncoder().encode(payload))) return null;
    // Verification yields. Consume after it so simultaneous replays cannot both
    // pass; expired proofs also cannot regain validity after their entry is pruned.
    for (const [value, expires] of used) if (expires < now) used.delete(value);
    if (used.has(nonce) || used.size >= 10_000) return null;
    used.set(nonce, Number(issued) + maxAge);
    const headers = new Headers(request.headers);
    headers.delete(proofHeader);
    headers.delete('x-forwarded-host');
    return new Request(request, { headers });
  };
}
