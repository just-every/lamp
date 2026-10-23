const origin = 'https://login.botframework.com';
const issuer = 'https://api.botframework.com';
let cached: { expires: number; keys: Array<JsonWebKey & { kid?: string }> } | undefined;
async function read(path: string) {
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password) throw new Error('Unexpected Bot Framework key origin.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url.href, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok || !response.body) throw new Error('Bot Framework keys are unavailable.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 128_000) throw new Error('Bot Framework keys are too large.'); chunks.push(value); } }
    finally { await reader.cancel(); }
    const body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } finally { clearTimeout(timer); }
}
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid token encoding.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}
/** Never use a token's jku/x5u to choose a key source. */
export async function verifyTeams(header: string | null, audience: string, now = Date.now()): Promise<Record<string, unknown> | null> {
  try {
    if (!header?.startsWith('Bearer ') || header.length > 16_384) return null;
    const parts = header.slice(7).split('.'); if (parts.length !== 3) return null;
    const tokenHeader = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (tokenHeader.alg !== 'RS256' || typeof tokenHeader.kid !== 'string' || tokenHeader.jku || tokenHeader.x5u) return null;
    if (claims.iss !== issuer || claims.aud !== audience || typeof claims.exp !== 'number' || claims.exp * 1000 <= now || typeof claims.nbf !== 'number' || claims.nbf * 1000 > now) return null;
    if (!cached || cached.expires <= now) {
      const metadata = await read('/v1/.well-known/openidconfiguration');
      if (metadata.issuer !== issuer || typeof metadata.jwks_uri !== 'string') return null;
      const result = await read(metadata.jwks_uri);
      if (!Array.isArray(result.keys) || result.keys.length > 30) return null;
      cached = { expires: now + 300_000, keys: result.keys };
    }
    const jwk = cached.keys.find(key => key.kid === tokenHeader.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)) ? claims : null;
  } catch { return null; }
}
