/** A public status page as its own public feeds describe it. Every field is the page's; nothing is guessed. */
export type StatusFeedVendor = "statuspage" | "instatus" | "betterstack";

/** One public response exactly as the page served it: JSON, Atom or RSS text. */
export interface StatusFeedFile { name: string; text: string }

export interface StatusFeedGroup { id: string; name: string; raw: unknown }

export interface StatusFeedComponent {
  id: string;
  /** The page's own name, with only its decoration (spacing, emoji) cleaned. */
  name: string;
  groupId: string | null;
  description: string;
  onlyShowIfDegraded: boolean;
  createdAt: string | null;
  raw: unknown;
}

export type StatusFeedState = "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance";

export interface StatusFeedUpdate {
  id: string;
  /** The lifecycle the page gave this update; "update" when it names none. */
  status: "investigating" | "identified" | "monitoring" | "resolved" | "postmortem" | "update";
  body: string;
  at: string;
  /** Component states this update states itself, by component id. */
  states: Array<{ componentId: string; state: StatusFeedState }>;
}

/** A past incident: resolved on the page, never one still open. */
export interface StatusFeedIncident {
  id: string;
  title: string;
  /** The incident's own address on the page, when its feed gives one. */
  url: string | null;
  shortlink: string | null;
  impact: "none" | "minor" | "major" | "critical" | null;
  startedAt: string;
  resolvedAt: string;
  /** Components the page names for it, by id. Only updates carry states. */
  components: string[];
  /** Oldest first. */
  updates: StatusFeedUpdate[];
  /** The record as read: the JSON element, or the feed entry's fields. */
  raw: unknown;
}

export interface StatusFeedPage {
  /** The page's address, where its feeds were read. */
  url: string;
  host: string;
  vendor: StatusFeedVendor;
  /** Statuspage's page ID or Better Stack's status page ID; Instatus publishes none. */
  pageId: string | null;
  name: string | null;
  /** In page order. */
  groups: StatusFeedGroup[];
  /** In page order, each group's components in their own order. */
  components: StatusFeedComponent[];
  /** Resolved incidents the page's public history holds, newest first. */
  incidents: StatusFeedIncident[];
}

export interface StatusFeedOptions {
  fetch?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
  /** Every feed of one read, together. Default 8 s. */
  timeoutMs?: number;
  maxRedirects?: number;
}
