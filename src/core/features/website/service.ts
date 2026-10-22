import { normaliseWebsite, isPublicAddress, type SiteRead, type SiteReadResult } from "../../platform/site-reader/index.ts";
import type { WebsiteRecord, WebsiteRepository, WebsiteStatusPage } from "./repository";

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
  };
}

export function createWebsiteService(repository: WebsiteRepository, options: { read: (input: string) => Promise<SiteReadResult>; readStatusPage: (url: string) => Promise<WebsiteStatusPage>; unavailable: string | null; changed?: () => Promise<void> }): WebsiteService {
  return {
    current: () => repository.get(),
    async read(input) {
      if (options.unavailable) return { found: null, message: options.unavailable, ...hostnamePageName(input) };
      const result = await options.read(input);
      if (!result.ok) {
        // The owner has moved on from the stored site, so the page must no longer link back to it.
        const current = await repository.get();
        if (current && siteHost(current.url) !== siteHost(input)) { await repository.clear(); await options.changed?.(); }
        return { found: null, message: result.message, ...(result.reason !== "invalid-url" && result.reason !== "refused-address" ? hostnamePageName(input) : {}) };
      }
      const detected = result.site.statusPage;
      const statusPage = detected ? await options.readStatusPage(detected.url).catch(() => ({ url: detected.url, source: null, pageId: null })) : null;
      await repository.record(result.site.url, statusPage);
      await options.changed?.();
      return { found: prefillFrom(result.site) };
    },
  };
}
