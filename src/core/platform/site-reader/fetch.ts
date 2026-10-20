import { isIpLiteral, isPublicAddress } from "./address.ts";
import type { SiteReadFailure } from "./types.ts";

export class SiteReadError extends Error {
  readonly reason: SiteReadFailure;
  constructor(reason: SiteReadFailure, message: string) { super(message); this.reason = reason; }
}

export interface GuardedFetchContext {
  fetch: typeof fetch;
  resolve: (hostname: string) => Promise<string[]>;
  signal: AbortSignal;
  maxRedirects: number;
}

const USER_AGENT = "LampSiteReader/1.0 (+https://run-lamp.com)";

/** Only http(s) on default ports, no credentials, and a host name that resolves to public addresses only. */
export function checkedUrl(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new SiteReadError("invalid-url", "Enter a website address like example.com."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SiteReadError("invalid-url", "Enter a website address like example.com.");
  if (url.username || url.password || url.port) throw new SiteReadError("refused-address", "That address isn't a public website.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!isIpLiteral(host) && (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host))) {
    throw new SiteReadError("refused-address", "That address isn't a public website.");
  }
  return url;
}

async function assertPublicHost(url: URL, context: GuardedFetchContext) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIpLiteral(host) ? [host] : await context.resolve(host).catch(() => { throw new SiteReadError("unreachable", "We couldn't reach that website."); });
  if (!addresses.length) throw new SiteReadError("unreachable", "We couldn't reach that website.");
  if (!addresses.every(isPublicAddress)) throw new SiteReadError("refused-address", "That address isn't a public website.");
}

/** Fetch with every redirect hop re-checked, then read at most maxBytes.
 * A larger body is cut at maxBytes when truncate is set and refused otherwise. */
export async function guardedFetch(start: URL, accept: string, maxBytes: number, truncate: boolean, context: GuardedFetchContext) {
  let url = start;
  for (let hop = 0; ; hop++) {
    url = checkedUrl(url);
    await assertPublicHost(url, context);
    let response: Response;
    try {
      response = await context.fetch(url.href, { redirect: "manual", signal: context.signal, headers: { Accept: accept, "User-Agent": USER_AGENT } });
    } catch {
      throw context.signal.aborted ? new SiteReadError("timeout", "That website took too long to answer.") : new SiteReadError("unreachable", "We couldn't reach that website.");
    }
    const location = response.headers.get("Location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      if (hop >= context.maxRedirects) throw new SiteReadError("unreachable", "That website redirects too many times.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SiteReadError("http-error", "We couldn't read that website.");
    }
    const declared = Number(response.headers.get("Content-Length"));
    if (!truncate && declared > maxBytes) {
      await response.body?.cancel();
      throw new SiteReadError("unreachable", "That file is too large.");
    }
    return { url, contentType: response.headers.get("Content-Type") ?? "", bytes: await readCapped(response, maxBytes, truncate, context.signal) };
  }
}

async function readCapped(response: Response, maxBytes: number, truncate: boolean, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        await reader.cancel();
        if (!truncate) throw new SiteReadError("unreachable", "That file is too large.");
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (cause) {
    if (cause instanceof SiteReadError) throw cause;
    throw signal.aborted ? new SiteReadError("timeout", "That website took too long to answer.") : new SiteReadError("unreachable", "We couldn't reach that website.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** A and AAAA records over DNS-over-HTTPS (RFC 8484 JSON form). */
export function dohResolver(transport: typeof fetch = fetch) {
  return async (hostname: string) => {
    const answers = await Promise.all([1, 28].map(async (type) => {
      const response = await transport(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error("DNS lookup failed.");
      const body = await response.json() as { Status?: number; Answer?: { type: number; data: string }[] };
      return body.Status === 0 ? (body.Answer ?? []).filter((answer) => answer.type === type).map((answer) => answer.data) : [];
    }));
    return answers.flat();
  };
}
