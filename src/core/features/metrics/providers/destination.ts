import { isIpLiteral, isPublicAddress } from "../../../platform/site-reader/address.ts";
import { checkedUrl } from "../../../platform/site-reader/fetch.ts";
import { list, object, requestJson } from "./common.ts";

/** Same address policy as site-reader, with HTTPS and no redirects for secrets. */
export async function prometheusDestination(endpoint: string | null, signal: AbortSignal): Promise<URL> {
  if (!endpoint) throw new Error("Prometheus needs a public HTTPS query endpoint.");
  let url: URL;
  try { url = checkedUrl(endpoint); }
  catch { throw new Error("Prometheus needs a public HTTPS endpoint without credentials or a custom port."); }
  if (url.protocol !== "https:" || url.search || url.hash) throw new Error("Prometheus needs a public HTTPS endpoint without query parameters or a fragment.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIpLiteral(host)) {
    if (!isPublicAddress(host)) throw new Error("Prometheus must use a public address.");
  } else {
    // Both address families must resolve successfully. Never fall back to direct
    // fetch when DNS fails, or when even one returned address is non-public.
    const answers = await Promise.all([1, 28].map(async (type) => {
      const dns = new URL("https://cloudflare-dns.com/dns-query");
      dns.searchParams.set("name", host);
      dns.searchParams.set("type", String(type));
      const body = object(await requestJson(dns, { headers: { Accept: "application/dns-json" } }, signal, 16_384));
      if (body.Status !== 0) throw new Error("Prometheus destination DNS lookup failed.");
      return list(body.Answer ?? [], 64).flatMap((entry) => {
        const answer = object(entry);
        if (answer.type !== 1 && answer.type !== 28) return [];
        if (typeof answer.data !== "string" || !isPublicAddress(answer.data)) throw new Error("Prometheus must use a public address.");
        return [answer.data];
      });
    }));
    if (!answers.flat().length) throw new Error("Prometheus destination has no public address.");
  }
  if (!url.pathname.endsWith("/api/v1/query_range")) url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v1/query_range`;
  return url;
}
