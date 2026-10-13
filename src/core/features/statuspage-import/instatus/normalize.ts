import { canonicalJson, sha256 } from "../../../../../modules/import-kit/src/d1/index.ts";
import type { Json, SourceRecord } from "../../../../../modules/import-kit/src/types.ts";
import type { Accounting } from "../rows";
import type { SavedFile, SourceData, SourceIncident } from "../source";
import { componentSchema, incidentSchema, maintenanceSchema, subscriberSchema } from "./schema";
import { resolveInstatusGroups } from "./groups";
import { readInstatusFiles, retainedInstatus } from "./saved";

const statuses: Record<string, string> = { OPERATIONAL: "operational", UNDERMAINTENANCE: "under_maintenance", DEGRADEDPERFORMANCE: "degraded_performance", PARTIALOUTAGE: "partial_outage", MAJOROUTAGE: "major_outage" };
const lifecycles = { INVESTIGATING: "investigating", IDENTIFIED: "identified", MONITORING: "monitoring", RESOLVED: "resolved", NOTSTARTEDYET: "scheduled", INPROGRESS: "in_progress", COMPLETED: "completed" } as const;
const unpublished = (raw: Record<string, unknown>) => raw.shouldPublish === false || raw.published === false || raw.isPublished === false || raw.draft === true;
const scoped = (raw: Record<string, unknown>) => raw.private === true || raw.useAllowList === true || (Array.isArray(raw.allowList) && raw.allowList.length > 0) || Boolean(raw.secureLink) || (Array.isArray(raw.audienceGroups) && raw.audienceGroups.length > 0);

/** Normalizes documented Instatus REST reads into the common import mapping.
 * The acknowledgement is owner input, never fabricated provider evidence. */
export async function readInstatusResponses(files: SavedFile[], options: { pageId?: string; publicAccessAcknowledged?: boolean }) {
  const saved = await readInstatusFiles(files, options.pageId ?? "");
  if (scoped(saved.page) || saved.collections["audience-groups"].length) throw new Error("Instatus private, allow-listed or audience-scoped pages cannot be moved to Lamp's public page.");
  if (!options.publicAccessAcknowledged) throw new Error("Confirm that this Instatus page and all supplied history are published and unrestricted; the saved pages response cannot establish that access.");
  if (unpublished(saved.page)) throw new Error("The Instatus source page is unpublished.");
  const wrongPage = (row: Record<string, unknown>) => {
    const site = row.site && typeof row.site === "object" ? row.site as Record<string, unknown> : undefined;
    return (row.siteId != null && row.siteId !== saved.page.id) || (site?.id != null && site.id !== saved.page.id);
  };
  const wrongPageHistory = (row: Record<string, unknown>) => wrongPage(row) || [row.components, row.updates].some((children) => Array.isArray(children) && children.some((child) => child && typeof child === "object" && wrongPage(child)));
  for (const resource of ["components", "incidents", "maintenances", "subscribers"] as const) for (const row of saved.collections[resource]) {
    if (wrongPageHistory(row)) throw new Error("An Instatus response contains a record belonging to a different page.");
  }
  for (const row of saved.details.values()) if (wrongPageHistory(row)) throw new Error("An Instatus maintenance detail belongs to a different page.");
  const resolved = resolveInstatusGroups(saved.collections.components.map((row) => componentSchema.parse(row)));
  const data: SourceData = { groups: [], components: [], incidents: [], maintenance: [], subscribers: [] };
  const records: SourceRecord[] = [], accounting: Accounting[] = [];
  const publicAddresses: Record<string, string[]> = {};
  const origins = new Map(saved.origins);
  const componentIds = new Set(resolved.components.map((row) => row.id));
  const created = saved.page.createdAt ?? "1970-01-01T00:00:00.000Z";
  function add(kind: string, raw: Record<string, unknown>, parentOrigin?: string) {
    const sourceId = String(raw.id), key = `${kind}:${sourceId}`;
    const origin = origins.get(key) ?? origins.get(parentOrigin ?? "")!;
    if (!origin) throw new Error("Instatus source provenance is incomplete.");
    origins.set(key, origin);
    const payload = retainedInstatus(raw);
    records.push({ namespace: "instatus", kind, sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: origin.sha256, location: { artifact: origin.name } });
  }
  function refusal(kind: string, row: Record<string, unknown>, reason: string, outcome: "skipped" | "rejected" = "rejected") {
    accounting.push({ kind, sourceId: String(row.id), name: kind === "subscriber" ? "Instatus subscriber" : String(row.name ?? kind), outcome, reason });
  }
  for (const group of resolved.groups) {
    if (wrongPage(group)) throw new Error("An Instatus visual group belongs to a different page.");
    const owner = resolved.components.find((row) => resolved.parentOf.get(row.id) === group.id);
    add("group", group, origins.has(`component:${group.id}`) ? `component:${group.id}` : `component:${owner?.id}`);
    data.groups.push({ id: group.id, name: group.name, description: group.description, components: resolved.components.filter((row) => resolved.parentOf.get(row.id) === group.id).map((row) => row.id), position: group.order ?? 0, created_at: group.createdAt ?? created });
  }
  for (const row of resolved.components) {
    add("component", row);
    if (row.siteId && row.siteId !== saved.page.id) throw new Error("An Instatus component belongs to a different page.");
    if (row.archivedAt || unpublished(row) || scoped(row)) throw new Error("Archived, unpublished or restricted Instatus components cannot be exposed on Lamp's public page.");
    if (!row.status) throw new Error("An Instatus component is missing its documented status.");
    data.components.push({ id: row.id, name: row.name, description: row.description, group_id: resolved.parentOf.get(row.id), position: row.order ?? 0, status: statuses[row.status] as SourceData["components"][number]["status"], created_at: row.createdAt ?? created });
  }
  for (const raw of saved.collections.incidents) {
    const row = incidentSchema.parse(raw); add("incident", row);
    if (unpublished(row) || scoped(row) || row.updates.some((update) => unpublished(update) || scoped(update))) { refusal("incident", row, "Unpublished or audience-scoped incident history cannot be made public."); continue; }
    if (row.components.some((component) => !componentIds.has(component.id) || !component.status)) { refusal("incident", row, "An affected component or its source status is absent from the saved Instatus responses."); continue; }
    if (new Set(row.updates.map((update) => update.id)).size !== row.updates.length) throw new Error("Instatus incident contains duplicate update identities.");
    data.incidents.push({ id: row.id, name: row.name, status: lifecycles[row.status], created_at: row.started, resolved_at: row.resolved, components: row.components.map(({ id }) => ({ id })), incident_updates: row.updates.map((update) => ({ id: `${row.id}:${update.id}`, status: lifecycles[update.status], body: update.message, created_at: update.createdAt ?? update.started, display_at: update.started, affected_components: row.components.map((component) => ({ code: component.id, new_status: statuses[component.status!] as SourceData["components"][number]["status"] })) })) });
  }
  for (const raw of saved.collections.maintenances) {
    const list = maintenanceSchema.parse(raw);
    const detail = saved.details.get(String(raw.id))!;
    const row = maintenanceSchema.parse({ ...list, ...detail, end: detail.end ?? list.end, duration: detail.duration ?? list.duration });
    add("maintenance", { id: detail.id, detail, list: raw });
    // An omitted detail flag cannot erase a known restriction in the list.
    if ([list, detail, ...list.updates, ...detail.updates].some((source) => unpublished(source) || scoped(source))) { refusal("maintenance", row, "Unpublished or audience-scoped maintenance history cannot be made public."); continue; }
    if (row.components!.some((component) => !componentIds.has(component.id))) { refusal("maintenance", row, "A maintenance component is absent from the saved Instatus components."); continue; }
    const applicableDuration = row.duration != null && (row.status === "COMPLETED" || row.autoEnd === true);
    const derivedInstant = applicableDuration ? new Date(Date.parse(row.start) + row.duration! * 60_000) : undefined;
    if (derivedInstant && !Number.isFinite(derivedInstant.getTime())) { refusal("maintenance", row, "Maintenance duration exceeds the supported date range."); continue; }
    const derivedEnd = derivedInstant?.toISOString();
    if (row.end && derivedEnd && Date.parse(row.end) !== Date.parse(derivedEnd)) { refusal("maintenance", row, "Maintenance end contradicts its documented duration in minutes."); continue; }
    const end = row.end ?? derivedEnd;
    if (!end || Date.parse(end) <= Date.parse(row.start)) { refusal("maintenance", row, "Maintenance has no valid end or applicable duration in minutes."); continue; }
    if (new Set(row.updates.map((update) => update.id)).size !== row.updates.length) throw new Error("Instatus maintenance contains duplicate update identities.");
    const window: SourceIncident = { id: row.id, name: row.name, status: lifecycles[row.status], created_at: row.start, scheduled_for: row.start, scheduled_until: end, resolved_at: row.status === "COMPLETED" ? end : undefined, components: row.components!.map(({ id }) => ({ id })), incident_updates: row.updates.map((update) => ({ id: `${row.id}:${update.id}`, status: lifecycles[update.status], body: update.message, created_at: update.createdAt ?? update.started, display_at: update.started })) };
    data.maintenance.push(window);
    if (!row.end) accounting.push({ kind: "maintenance", sourceId: row.id, name: row.name, outcome: "changed", reason: `End derived from start plus ${row.duration} documented minutes (${row.status === "COMPLETED" ? "completed duration" : "autoEnd planned duration"}); ${row.updates.length} updates retained silently.` });
  }
  for (const raw of saved.collections.subscribers) {
    const row = subscriberSchema.parse(raw); add("subscriber", row);
    const channels = [row.phone && "phone", row.webhook && "webhook", row.webhookEmail && "webhook contact", (row.slack || row.slackTeam) && "Slack", (row.discord || row.discordTeam) && "Discord", (row.teams || row.microsoftTeamsWebhook) && "Microsoft Teams", (row.googleChat || row.googleChatWebhook || row.googleChatSpace) && "Google Chat"].filter(Boolean);
    let reason: string | undefined;
    if (channels.length || !row.email) reason = `Unsupported Instatus ${channels.join(" / ") || "non-email"} subscription; only email subscriptions can move.`;
    else if (row.unsubscribed === true || row.unsubscribedAt || row.deletedAt) reason = "Unsubscribed or deleted at Instatus; consent was not carried.";
    else if (!row.confirmed) reason = "Unconfirmed at Instatus; no subscription or invitation was created.";
    else if (!row.approved) reason = "Unapproved at Instatus; no subscription or invitation was created.";
    else if ((!row.all && !row.components.length) || row.components.some((id) => !componentIds.has(id))) reason = "Instatus component preferences are empty or unresolved; importing would broaden the subscription.";
    else if (row.all && row.components.length) reason = "Instatus all-components flag conflicts with explicit component preferences.";
    if (reason) { refusal("subscriber", row, reason, "skipped"); continue; }
    data.subscribers.push({ id: row.id, mode: "email", email: row.email, components: row.all ? [] : [...new Set(row.components)] });
  }
  if (saved.summary) {
    const pageUrl = new URL(saved.summary.page.url);
    const hosts = [`${saved.page.subdomain}.instatus.com`.toLowerCase()];
    if (saved.page.customDomain) {
      try { hosts.push(new URL(saved.page.customDomain.includes("://") ? saved.page.customDomain : `https://${saved.page.customDomain}`).hostname.toLowerCase()); }
      catch { throw new Error("Instatus page has an invalid saved custom domain."); }
    }
    if (!["https:", "http:"].includes(pageUrl.protocol) || pageUrl.username || pageUrl.password || pageUrl.search || pageUrl.hash || !hosts.includes(pageUrl.hostname.toLowerCase())) throw new Error("The Instatus public summary URL does not match the selected page's saved domain.");
    if (saved.summary.page.id && saved.summary.page.id !== saved.page.id) throw new Error("The Instatus public summary belongs to another page.");
    for (const [kind, links] of [["incident", [...saved.summary.activeIncidents, ...saved.summary.recentlyResolvedIncidents ?? []]], ["maintenance", saved.summary.activeMaintenances]] as const) {
      for (const link of links) {
        if (!records.some((record) => record.kind === kind && record.sourceId === link.id)) throw new Error("An Instatus public summary URL has no matching management record ID.");
        const key = `${kind}:${link.id}`;
        if (publicAddresses[key]) throw new Error("Instatus public summary repeats a record URL identity.");
        const address = new URL(link.url);
        if (!["http:", "https:"].includes(address.protocol) || address.username || address.password || address.search || address.hash || address.href !== link.url) throw new Error("An Instatus public URL is unsafe or includes access credentials; no address was retained.");
        publicAddresses[key] = [link.url];
      }
    }
  }
  return { namespace: "instatus" as const, data, records, artifacts: saved.artifacts, origins, accounting, publicAddresses, sourceInfo: { label: "Instatus", pageId: saved.page.id, publicUrl: saved.summary?.page.url ?? "" }, ownerPublicAccessAcknowledged: true };
}
