import { checkedUrl, dohResolver, guardedFetch, type GuardedFetchContext } from "../../platform/site-reader/fetch.ts";
import { scanHtml } from "../../platform/site-reader/html.ts";
import type { SiteReadOptions } from "../../platform/site-reader/types.ts";
import { readStatusFeeds, type StatusFeedPage } from "../../platform/status-feeds/index.ts";
import type { WebsiteStatusPage } from "./repository";

function providerHost(host: string): WebsiteStatusPage["source"] {
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (matches("statuspage.io")) return "statuspage";
  if (matches("betteruptime.com") || matches("betterstack.com")) return "betterstack";
  if (matches("instatus.com")) return "instatus";
  if (matches("sorryapp.com")) return "sorry";
  return null;
}

/** The page found, and for a Statuspage, Instatus or Better Stack page what its own public feeds say: its
 * components, groups and past incidents. */
export interface StatusPageRead { page: WebsiteStatusPage; feeds: StatusFeedPage | null }

/** Public discovery only. It never authenticates and imports nothing; Move in imports. */
export async function readStatusPage(input: string, options: SiteReadOptions = {}): Promise<StatusPageRead> {
  const detected: WebsiteStatusPage = { url: input, source: null, pageId: null };
  const transport = options.fetch ?? fetch;
  const budget = options.timeoutMs ?? 8000, deadline = Date.now() + budget;
  const context: GuardedFetchContext = {
    fetch: (url, init) => transport(url, init),
    resolve: options.resolve ?? dohResolver(),
    signal: AbortSignal.timeout(budget),
    maxRedirects: options.maxRedirects ?? 5,
  };
  let feeds: StatusFeedPage | null = null;
  try {
    const landing = await guardedFetch(checkedUrl(input), "text/html,application/xhtml+xml", 1_500_000, true, context);
    detected.url = landing.url.href;
    detected.source = providerHost(landing.url.hostname);
    if (/html|xml/i.test(landing.contentType)) {
      const html = new TextDecoder().decode(landing.bytes);
      const scan = scanHtml(html);
      // Attribution links name the platform even when the page uses its own hostname.
      for (const anchor of scan.anchors) {
        if (anchor.region !== "footer" && !/powered by|statuspage|better stack|instatus|sorry/i.test(anchor.text)) continue;
        try {
          const target = new URL(anchor.href, landing.url);
          const source = providerHost(target.hostname)
            ?? ((target.hostname === "www.atlassian.com" || target.hostname === "atlassian.com") && /^\/software\/statuspage\/?$/.test(target.pathname) ? "statuspage" : null);
          if (source) { detected.source = source; break; }
        } catch { /* An invalid link supplies no provider evidence. */ }
      }
      // Statuspage's published asset origin identifies custom-domain pages too.
      const assetUrls = [...scan.tags.map((tag) => tag.attributes.href ?? tag.attributes.src), ...[...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1])];
      if (!detected.source && assetUrls.some((href) => {
        if (!href) return false;
        try { const asset = new URL(href, landing.url); return asset.hostname === "dka575ofm4ao0.cloudfront.net" && asset.pathname.startsWith("/assets/"); }
        catch { return false; }
      })) detected.source = "statuspage";
    }
    const source = detected.source;
    if (source === "statuspage" || source === "instatus" || source === "betterstack") {
      const read = await readStatusFeeds(landing.url.href, source, { ...options, fetch: context.fetch, resolve: context.resolve, timeoutMs: Math.max(1, deadline - Date.now()) });
      feeds = read?.page ?? null;
      detected.pageId = feeds?.pageId ?? null;
    }
  } catch { /* Keep the linked address when the optional public metadata cannot be read. */ }
  return { page: detected, feeds };
}
