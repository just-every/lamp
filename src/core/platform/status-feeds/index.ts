import { checkedUrl, dohResolver, guardedFetch, type GuardedFetchContext } from "../site-reader/fetch.ts";
import { betterstackIncidents, betterstackIndex } from "./betterstack.ts";
import { instatusComponents, instatusIncidents, instatusSummary } from "./instatus.ts";
import { statuspageIncidents, statuspageSummary } from "./statuspage.ts";
import type { StatusFeedFile, StatusFeedOptions, StatusFeedPage, StatusFeedVendor } from "./types.ts";

export type * from "./types.ts";

/** Each vendor's public feeds, at fixed paths on the page's own origin. The page's components come from the first ones;
 * its history feed is read too, and a page whose history does not answer still gives its components. */
const FEEDS: Record<StatusFeedVendor, Array<{ name: string; path: string; accept: string; maxBytes: number; history?: true }>> = {
  statuspage: [
    { name: "public-summary.json", path: "/api/v2/summary.json", accept: "application/json", maxBytes: 1_000_000 },
    { name: "public-incidents.json", path: "/api/v2/incidents.json", accept: "application/json", maxBytes: 3_000_000, history: true },
  ],
  instatus: [
    { name: "public-summary.json", path: "/summary.json", accept: "application/json", maxBytes: 1_000_000 },
    { name: "public-components.json", path: "/v2/components.json", accept: "application/json", maxBytes: 1_000_000 },
    { name: "public-history.atom", path: "/history.atom", accept: "application/atom+xml,application/xml,text/xml", maxBytes: 3_000_000, history: true },
  ],
  betterstack: [
    { name: "public-index.json", path: "/index.json", accept: "application/json", maxBytes: 3_000_000 },
    { name: "public-feed.rss", path: "/feed", accept: "application/rss+xml,application/xml,text/xml", maxBytes: 3_000_000, history: true },
  ],
};

/** The names a capture of each vendor's feeds uses, so saved files say which page read they are. */
export const statusFeedFileNames = Object.fromEntries(Object.entries(FEEDS).map(([vendor, feeds]) => [vendor, feeds.map((feed) => feed.name)])) as Record<StatusFeedVendor, string[]>;

/** Reads a page's public feeds once, as they are: every request public-only on every hop, keyless, with one deadline.
 * Throws when a feed its components need does not answer. */
export async function captureStatusFeeds(input: string, vendor: StatusFeedVendor, options: StatusFeedOptions = {}): Promise<StatusFeedFile[]> {
  const origin = checkedUrl(input).origin;
  // Called unbound: Workers refuse a global fetch invoked as a method of another object.
  const transport = options.fetch ?? fetch;
  const context: GuardedFetchContext = { fetch: (url, init) => transport(url, init), resolve: options.resolve ?? dohResolver(), signal: AbortSignal.timeout(options.timeoutMs ?? 8000), maxRedirects: options.maxRedirects ?? 5 };
  const read = await Promise.all(FEEDS[vendor].map(async (feed) => {
    try {
      const response = await guardedFetch(new URL(feed.path, origin), feed.accept, feed.maxBytes, false, context);
      return { name: feed.name, text: new TextDecoder("utf-8", { fatal: true }).decode(response.bytes) };
    } catch (cause) {
      if (feed.history) return null;
      throw cause;
    }
  }));
  return read.filter((file): file is StatusFeedFile => file !== null);
}

/** What a capture says: the page, its groups and components in page order, and its resolved incidents. */
export function parseStatusFeeds(vendor: StatusFeedVendor, input: string, files: StatusFeedFile[]): StatusFeedPage {
  const url = checkedUrl(input), origin = url.origin;
  const file = (name: string) => files.find((entry) => entry.name === name)?.text ?? null;
  const json = (name: string) => { const text = file(name); return text === null ? null : JSON.parse(text) as unknown; };
  const page = { url: `${origin}/`, host: url.hostname, vendor };
  if (vendor === "statuspage") {
    const summary = statuspageSummary(json("public-summary.json"));
    const history = json("public-incidents.json");
    const known = new Set(summary.components.map((component) => component.id));
    return { ...page, pageId: summary.pageId, name: summary.name, groups: summary.groups, components: summary.components, incidents: history === null ? [] : statuspageIncidents(history, known) };
  }
  if (vendor === "instatus") {
    const summary = instatusSummary(json("public-summary.json"));
    const { groups, components } = instatusComponents(json("public-components.json"));
    const atom = file("public-history.atom");
    return { ...page, pageId: null, name: summary.name, groups, components, incidents: atom === null ? [] : instatusIncidents(atom, components, summary.active) };
  }
  const index = betterstackIndex(json("public-index.json"));
  // Its ID names the page only when the page says this is its address.
  return { ...page, pageId: index.hosts.includes(url.hostname) ? index.pageId : null, name: index.name, groups: index.groups, components: index.components, incidents: betterstackIncidents(index, file("public-feed.rss")) };
}

/** A page's public feeds, read and understood; null when they do not answer as that vendor's page does. */
export async function readStatusFeeds(input: string, vendor: StatusFeedVendor, options: StatusFeedOptions = {}): Promise<{ page: StatusFeedPage; files: StatusFeedFile[] } | null> {
  try {
    const files = await captureStatusFeeds(input, vendor, options);
    try { return { page: parseStatusFeeds(vendor, input, files), files }; }
    catch {
      // A history feed that does not read as one still leaves the page's components.
      const current = files.filter((file) => !FEEDS[vendor].some((feed) => feed.history && feed.name === file.name));
      return { page: parseStatusFeeds(vendor, input, current), files: current };
    }
  } catch {
    return null;
  }
}
