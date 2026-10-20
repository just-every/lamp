import type { SiteRead, SiteReadResult } from "../../platform/site-reader/index.ts";
import type { WebsiteRecord, WebsiteRepository } from "./repository";

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

export type WebsiteReadResponse = { found: WebsitePrefill } | { found: null; message: string };

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

export function createWebsiteService(repository: WebsiteRepository, options: { read: (input: string) => Promise<SiteReadResult>; unavailable: string | null }): WebsiteService {
  return {
    current: () => repository.get(),
    async read(input) {
      if (options.unavailable) return { found: null, message: options.unavailable };
      const result = await options.read(input);
      if (!result.ok) return { found: null, message: result.message };
      await repository.record(result.site.url);
      return { found: prefillFrom(result.site) };
    },
  };
}
