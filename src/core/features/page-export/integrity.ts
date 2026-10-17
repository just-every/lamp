import { constantTimeEqual, hmacSha256 } from "../../platform/security/opaque-tokens";
import type { PageDataFile } from "./format";

/**
 * A page data file's integrity value: an HMAC over the file, keyed by a key
 * derived from the installation's SUBSCRIBER_TOKEN_SECRET. The file carries the
 * value, never the key, so only an installation holding that secret (the one
 * that exported it, or a recovery given its signing secrets) can recompute it.
 * A file edited by hand, or made anywhere else, cannot show confirmed consent.
 */
const KEY_CONTEXT = "lamp-page-data-integrity.v1";

// Keys sorted at every level: the value covers what the file says, not how a
// browser or editor spaced or ordered it.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function integrityValue(secret: string, file: Omit<PageDataFile, "integrity">) {
  return hmacSha256(await hmacSha256(secret, KEY_CONTEXT), canonical(file));
}

export async function signPageData(secret: string, file: Omit<PageDataFile, "integrity">): Promise<PageDataFile> {
  return { ...file, integrity: { algorithm: "HMAC-SHA256", value: await integrityValue(secret, file) } };
}

export type PageDataProvenance = "verified" | "unsigned" | "unverified";

export async function pageDataProvenance(secret: string, file: PageDataFile): Promise<PageDataProvenance> {
  const { integrity, ...content } = file;
  if (!integrity) return "unsigned";
  return constantTimeEqual(integrity.value, await integrityValue(secret, content)) ? "verified" : "unverified";
}
