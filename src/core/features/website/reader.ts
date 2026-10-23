import { readSite } from "../../platform/site-reader/index.ts";
import type { SiteReadOptions } from "../../platform/site-reader/types.ts";
import { captureStatusFeeds, type StatusFeedVendor } from "../../platform/status-feeds/index.ts";
import { readStatusPage } from "./status-page-reader";

function readerOptions(devSiteOrigin: string | undefined): SiteReadOptions {
  if (!devSiteOrigin) return {};
  return {
    resolve: async () => ["93.184.215.14"],
    fetch: async (url, init) => {
      const target = new URL(String(url));
      const headers = new Headers(init?.headers);
      headers.set("X-Lamp-Site-Host", target.host);
      return fetch(`${devSiteOrigin}${target.pathname}${target.search}`, { ...init, headers });
    },
  };
}

/** The site reader as Lamp runs it. In local Vite development only, a loopback
 * stand-in can play the internet: every request goes to it with the original
 * host in X-Lamp-Site-Host, and every name resolves to a public address. */
export function websiteReader(devSiteOrigin: string | undefined) {
  const options = readerOptions(devSiteOrigin);
  return (input: string) => readSite(input, options);
}

export function statusPageReader(devSiteOrigin: string | undefined) {
  const options = readerOptions(devSiteOrigin);
  return (url: string) => readStatusPage(url, options);
}

/** A found status page's public feeds as they are, for Move in to bring its history across: the same guard and stand-in. */
export function statusFeedCapture(devSiteOrigin: string | undefined) {
  const options = readerOptions(devSiteOrigin);
  return (vendor: StatusFeedVendor, url: string) => captureStatusFeeds(url, vendor, options);
}
