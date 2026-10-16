import { API_ROOT } from "./betterstack/schema";

export interface SourcePage { id: string; name: string; address: string | null }
type Finder = "betterstack" | "instatus";

const MAX_PAGES = 200;
const label = (source: Finder) => source === "betterstack" ? "Better Stack" : "Instatus";

/** Lists the status pages a token can read, so the owner can pick one instead of hunting for its ID.
 * Fixed-origin GETs only; the key is never stored, returned or forwarded on a redirect. */
export async function findSourcePages(input: { source: Finder; apiKey: string; fetcher?: typeof fetch }): Promise<SourcePage[]> {
  const fetcher = input.fetcher ?? fetch;
  const valid = input.source === "betterstack" ? /^[\x21-\x7e]{16,200}$/u : /^[A-Za-z0-9._-]{16,256}$/u;
  if (!valid.test(input.apiKey)) throw new Error(`Paste your ${label(input.source)} ${input.source === "betterstack" ? "API token" : "API key"} first.`);
  async function get(url: string): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(url, { method: "GET", redirect: "manual", headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw new Error(`Lamp could not reach ${label(input.source)}. Try again in a moment.`); }
    if (response.status === 401 || response.status === 403) throw new Error(`${label(input.source)} refused this ${input.source === "betterstack" ? "token" : "key"}. Copy it again and retry.`);
    if (!response.ok) throw new Error(`${label(input.source)} answered HTTP ${response.status}. Try again in a moment.`);
    try { return await response.json(); } catch { throw new Error(`${label(input.source)} returned a response Lamp could not read.`); }
  }
  const pages: SourcePage[] = [];
  if (input.source === "betterstack") {
    let url: string | null = `${API_ROOT}/status-pages`;
    for (let page = 1; url && page <= 10; page += 1) {
      const body = await get(url) as { data?: Array<{ id?: unknown; attributes?: { company_name?: unknown; subdomain?: unknown; custom_domain?: unknown } }>; pagination?: { next?: unknown } };
      for (const row of body.data ?? []) {
        const attributes = row.attributes ?? {};
        const address = typeof attributes.custom_domain === "string" && attributes.custom_domain ? attributes.custom_domain : typeof attributes.subdomain === "string" ? `${attributes.subdomain}.betteruptime.com` : null;
        pages.push({ id: String(row.id), name: typeof attributes.company_name === "string" ? attributes.company_name : "Untitled status page", address });
      }
      const next = body.pagination?.next;
      url = typeof next === "string" && new URL(next).origin === new URL(API_ROOT).origin ? next : null;
    }
  } else {
    for (let page = 1; page <= 2; page += 1) {
      const rows = await get(`https://api.instatus.com/v2/pages?page=${page}&per_page=100`);
      if (!Array.isArray(rows)) throw new Error("Instatus returned a response Lamp could not read.");
      for (const row of rows as Array<{ id?: unknown; name?: unknown; subdomain?: unknown; customDomain?: unknown }>) {
        const address = typeof row.customDomain === "string" && row.customDomain ? row.customDomain : typeof row.subdomain === "string" ? `${row.subdomain}.instatus.com` : null;
        pages.push({ id: String(row.id), name: typeof row.name === "string" ? row.name : "Untitled status page", address });
      }
      if (rows.length < 100) break;
    }
  }
  return pages.slice(0, MAX_PAGES);
}
