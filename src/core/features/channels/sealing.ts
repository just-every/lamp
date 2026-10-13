/** Channel webhook URLs are bearer secrets: Lamp keeps only AES-GCM ciphertext,
 * keyed from WEBHOOK_SIGNING_SECRET (HKDF) and bound to the destination's ID.
 * The first listed secret seals; every listed secret may open, so a rotation
 * that keeps the old secret second keeps existing channels working. */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytesOf = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function keyFor(secret: string) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("lamp.channel-destination"), info: encoder.encode("v1") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function sealingSecrets(value: string | undefined): string[] {
  const secrets = (value ?? "").split(",").map((secret) => secret.trim()).filter(Boolean);
  if (!secrets.length) throw new Error("WEBHOOK_SIGNING_SECRET is required to store Slack and Teams channel addresses.");
  return secrets;
}

export async function sealUrl(url: string, destinationId: string, secrets: string[]): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(destinationId) }, await keyFor(secrets[0]), encoder.encode(url)));
  return `v1.${base64(iv)}.${base64(sealed)}`;
}

export async function openUrl(sealed: string, destinationId: string, secrets: string[]): Promise<string> {
  const [version, iv, body] = sealed.split(".");
  if (version !== "v1" || !iv || !body) throw new Error("Channel address unavailable");
  for (const secret of secrets) {
    try {
      return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytesOf(iv), additionalData: encoder.encode(destinationId) }, await keyFor(secret), bytesOf(body)));
    } catch { /* Try the next listed secret. */ }
  }
  throw new Error("Channel address unavailable");
}
