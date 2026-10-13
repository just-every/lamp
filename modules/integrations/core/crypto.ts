const encoder = new TextEncoder();
export const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export async function sha256(text: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))); }
export function randomId() { return crypto.randomUUID(); }
export function assertLabel(value: string, name = 'identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(value)) throw new Error(`Invalid ${name}`);
}
export function assertCode(code: string) { if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(code)) throw new Error('Invalid safe outcome code'); }
export async function hmacBytes(key: Uint8Array, data: string) {
  if (!(key instanceof Uint8Array) || key.length < 32) throw new Error('HMAC key must contain at least 32 bytes');
  const imported = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(data)));
}
export async function hmac(key: Uint8Array, data: string) { return hex(await hmacBytes(key, data)); }
export function equalSignature(a: string, b: string) {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
