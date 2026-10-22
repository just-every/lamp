import { normaliseWebsite, isPublicAddress, type SiteRead, type SiteReadResult } from "../../platform/site-reader/index.ts";
import { siteDomain } from "../../platform/site-reader/domain.ts";
import type { WebsiteRecord, WebsiteRepository } from "./repository";
import { existingPageFrom, type ExistingStatusPage } from "./existing-page.ts";
import type { StatusPageRead } from "./status-page-reader";

/** What Lamp fills in from a website. Only what the site gave; the owner edits any of it. */
export interface WebsitePrefill {
  website: string;
  host: string;
  /** The site's name with " Status", or the host name when the site names nothing. */
  pageName: string;
  tagline: string | null;
  accentColor: string | null;
  mark: { url: string; contentType: string; dataUrl: string } | null;
  components: { name: string; url: string }[];
  statusPage: string | null;
  /** The status page the business already runs, as its own public feeds describe it: its components and groups
   * take the place of the ones read from the site's navigation. */
  existingPage: ExistingStatusPage | null;
}

export type WebsiteReadResponse = { found: WebsitePrefill } | { found: null; message: string; pageName?: string };

function hostnamePageName(input: string): { pageName?: string } {
  try {
    const host = normaliseWebsite(input).hostname.replace(/^www\./, "");
    if ((host.includes(":") || /^[\d.]+$/.test(host)) && !isPublicAddress(host.replace(/^\[|\]$/g, ""))) return {};
    return { pageName: `${host} Status`.slice(0, 120) };
  } catch { return {}; }
}

const siteHost = (input: string) => {
  try { return normaliseWebsite(input).hostname.replace(/^www\./, ""); } catch { return null; }
};

export interface WebsiteService {
  current(): Promise<WebsiteRecord | null>;
  read(input: string): Promise<WebsiteReadResponse>;
}

export function prefillFrom(site: SiteRead): WebsitePrefill {
  const host = site.host.replace(/^www\./, "");
  return {
    website: site.url,
    host,
    pageName: `${site.name ?? host} Status`.slice(0, 120),
    // A status page's tagline is the business in a sentence: the description's first one, not its call to action.
    tagline: site.description?.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? site.description,
    accentColor: site.accent?.toUpperCase() ?? null,
    mark: site.icon ? { url: site.icon.url, contentType: site.icon.contentType, dataUrl: site.icon.dataUrl } : null,
    components: site.components,
    statusPage: site.statusPage?.url ?? null,
    existingPage: null,
  };
}

export function createWebsiteService(repository: WebsiteRepository, options: { read: (input: string) => Promise<SiteReadResult>; readStatusPage: (url: string) => Promise<StatusPageRead>; unavailable: string | null }): WebsiteService {
  return {
    current: () => repository.get(),
    async read(input) {
      if (options.unavailable) return { found: null, message: options.unavailable, ...hostnamePageName(input) };
      const result = await options.read(input);
      if (!result.ok) {
        // The owner has moved on from the stored site, so the page must no longer link back to it.
        const current = await repository.get();
        if (current && siteHost(current.url) !== siteHost(input)) await repository.clear();
        return { found: null, message: result.message, ...(result.reason !== "invalid-url" && result.reason !== "refused-address" ? hostnamePageName(input) : {}) };
      }
      const linked = result.site.statusPage;
      // The link a site gives for its status page may be a marketing page, so the common subdomain of its host is
      // tried as well, one candidate after another until one's own feeds answer as a Statuspage, Instatus or Better
      // Stack page with components. Only such a page, or the site's own link, counts as found.
      const host = result.site.host.replace(/^www\./, "");
      const candidates = [...new Set([linked?.url, `https://status.${siteDomain(host)}/`, `https://status.${host}/`].filter((address): address is string => Boolean(address)))];
      let recognised: StatusPageRead | null = null;
      let linkedRead: StatusPageRead | null = null;
      for (const address of candidates) {
        const read = await options.readStatusPage(address).catch(() => null);
        if (address === linked?.url) linkedRead = read;
        if (read?.feeds?.components.length) { recognised = read; break; }
      }
      const statusPage = recognised ? recognised.page : linked ? linkedRead?.page ?? { url: linked.url, source: null, pageId: null } : null;
      await repository.record(result.site.url, statusPage);
      const prefill = prefillFrom(result.site);
      return { found: { ...prefill, statusPage: (recognised && recognised !== linkedRead ? recognised.page.url : prefill.statusPage) ?? statusPage?.url ?? null, existingPage: existingPageFrom(recognised?.feeds ?? linkedRead?.feeds ?? null) } };
    },
  };
}
