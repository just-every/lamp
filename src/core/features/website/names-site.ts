import { siteDomain } from "../../platform/site-reader/domain.ts";
import type { StatusPageRead } from "./status-page-reader";

// Status vendors give each customer's page a subdomain of their own domain (koyeb.instatus.com): an address there
// names whichever customer took it, never the site the vendor's domain belongs to.
const VENDOR_HOSTING = ["statuspage.io", "instatus.com", "betteruptime.com"];
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether a status page found only by guessing its address names the site it was guessed for: the address it gives
 * as its own or the homepage it gives is on the site's registrable domain (the site's own host included), or its name
 * is the one that domain spells ("Better Stack" for betterstack.com). Nothing else of the page counts. */
export function namesSite(read: StatusPageRead, siteHost: string) {
  const domain = siteDomain(siteHost);
  const onSite = (address: string | null | undefined) => {
    if (!address) return false;
    let host: string;
    try { host = new URL(address).hostname.toLowerCase(); } catch { return false; }
    return !VENDOR_HOSTING.some((vendor) => host.endsWith(`.${vendor}`)) && siteDomain(host) === domain;
  };
  const name = squash(read.feeds?.name ?? "");
  return [read.feeds?.address, read.feeds?.homepage, read.homepage].some(onSite)
    || (name.length > 0 && (name === squash(domain) || name === squash(domain.split(".")[0])));
}
