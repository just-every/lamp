import type { StatusFeedPage, StatusFeedVendor } from "../../platform/status-feeds/index.ts";

/** A status page the business already runs, as setup offers it: the page's own components and groups, in its order,
 * and how many past incidents its public history holds for Move in to bring across. */
export interface ExistingStatusPage {
  url: string;
  host: string;
  source: StatusFeedVendor;
  groups: { id: string; name: string }[];
  components: { id: string; name: string; groupId: string | null }[];
  pastIncidents: number;
}

/** Only a page that lists components replaces what the site's navigation gave; any other changes nothing. */
export function existingPageFrom(feeds: StatusFeedPage | null): ExistingStatusPage | null {
  if (!feeds?.components.length) return null;
  return {
    url: feeds.url, host: feeds.host.replace(/^www\./, ""), source: feeds.vendor,
    groups: feeds.groups.map(({ id, name }) => ({ id, name })),
    components: feeds.components.map(({ id, name, groupId }) => ({ id, name, groupId })),
    pastIncidents: feeds.incidents.length,
  };
}
