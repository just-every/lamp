import { constantTimeEqual } from "../security/opaque-tokens";

function paddedBase64(value: string) {
  return value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
}

function base64Url(bytes: Uint8Array) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Raw-body Svix verification for Resend's signed delivery webhooks. */
export async function verifyResendWebhook(input: { secret: string; id: string | null | undefined; timestamp: string | null | undefined; signature: string | null | undefined; rawBody: string }) {
  if (!input.id || !input.timestamp || !input.signature || !input.secret.startsWith("whsec_")) return false;
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp * 1000) > 5 * 60 * 1000) return false;
  let keyBytes: Uint8Array;
  try {
    const decoded = atob(paddedBase64(input.secret.slice("whsec_".length)));
    keyBytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch { return false; }
  const key = await crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.rawBody}`);
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, signed)));
  return input.signature.split(" ").some((part) => {
    const [version, received] = part.split(",");
    try { return version === "v1" && Boolean(received) && constantTimeEqual(signature, base64Url(Uint8Array.from(atob(paddedBase64(received)), (character) => character.charCodeAt(0)))); }
    catch { return false; }
  });
}
