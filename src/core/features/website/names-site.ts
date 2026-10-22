import { siteDomain } from "../../platform/site-reader/domain.ts";
import type { StatusPageRead } from "./status-page-reader";

// Status vendors give each customer's page a subdomain of their own domain (koyeb.instatus.com): an address there
// names whichever customer took it, never the site the vendor's domain belongs to.
const VENDOR_HOSTING = ["statuspage.io", "instatus.com", "betteruptime.com"];
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const hostOf = (address: string | null | undefined) => {
  if (!address) return null;
  try { return new URL(address).hostname.toLowerCase().replace(/\.$/, ""); } catch { return null; }
};

/** Whether a status page found only by guessing its address (`guessedAt`) names the site it was guessed for: the
 * address it gives as its own or the homepage it gives is on the site's registrable domain (the site's own host
 * included), or its name is the one that domain spells ("Better Stack" for betterstack.com). A site below its
 * registrable domain shares that domain with whoever owns it, often a platform the Public Suffix List does not list
 * (simonw.substack.com and Substack), so the page at status.<that domain> must name the site's own host: its address
 * or homepage on that host or beneath it. Nothing else of the page counts. */
export function namesSite(read: StatusPageRead, siteHost: string, guessedAt: string) {
  const host = siteHost.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const domain = siteDomain(host);
  const given = [read.feeds?.address, read.feeds?.homepage, read.homepage].map(hostOf).filter((name): name is string => name !== null);
  if (host !== domain && hostOf(guessedAt) === `status.${domain}`) return given.some((name) => name === host || name.endsWith(`.${host}`));
  const name = squash(read.feeds?.name ?? "");
  return given.some((own) => !VENDOR_HOSTING.some((vendor) => own.endsWith(`.${vendor}`)) && siteDomain(own) === domain)
    || (name.length > 0 && (name === squash(domain) || name === squash(domain.split(".")[0])));
}
