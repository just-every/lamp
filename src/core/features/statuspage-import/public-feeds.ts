import { parseStatusFeeds, statusFeedFileNames, type StatusFeedIncident, type StatusFeedVendor } from "../../platform/status-feeds/index.ts";
import { canonicalJson, sha256 } from "../../../../modules/import-kit/src/d1/index.ts";
import type { Json, SourceArtifact, SourceRecord } from "../../../../modules/import-kit/src/types.ts";
import type { Accounting } from "./rows";
import type { ReadSource, SavedFile, SourceComponent, SourceData, SourceGroup, SourceIncident, SourceUpdate } from "./source";
import { importLimits } from "./source";

const labels: Record<StatusFeedVendor, string> = { statuspage: "Statuspage", instatus: "Instatus", betterstack: "Better Stack" };
const historyFile: Record<StatusFeedVendor, string> = { statuspage: "public-incidents.json", instatus: "public-history.atom", betterstack: "public-feed.rss" };
const EPOCH = "1970-01-01T00:00:00.000Z";

/** Files a keyless read of a page's public feeds saved, rather than an account's API responses. */
export function isPublicFeedCapture(vendor: StatusFeedVendor, files: SavedFile[]) {
  return files.length > 0 && files.every((file) => statusFeedFileNames[vendor].includes(file.name));
}

export interface PublicFeedInput {
  publicUrl?: string;
  /** The components the owner kept at setup, by the page's own IDs, with the names they gave them, in their order. */
  components?: Array<{ id: string; name: string }>;
}

function artifact(file: SavedFile): SourceArtifact {
  const bytes = new TextEncoder().encode(file.text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { name: file.name, sha256: sha256(bytes), size: bytes.length, original: { status: "available", base64: btoa(binary) } };
}

/** Move in's keyless reader: a page's public feeds, read by Lamp itself, become its past incidents as resolved
 * history, with the components and groups they need. Feeds carry no subscribers and no access rules; what they
 * show is already public. Nothing open on the page is read. */
export function readPublicFeeds(vendor: StatusFeedVendor, files: SavedFile[], input: PublicFeedInput): ReadSource & { accounting: Accounting[]; publicAddresses: Record<string, string[]>; sourceInfo: { label: string; pageId: string; publicUrl: string } } {
  if (!input.publicUrl) throw new Error("Name the public status page these feeds were read from.");
  if (new Set(files.map((file) => file.name)).size !== files.length) throw new Error("Duplicate public feed file.");
  if (files.reduce((sum, file) => sum + new TextEncoder().encode(file.text).length, 0) > importLimits.maxBytes) throw new Error("The public feeds exceed the 8 MiB limit.");
  if (!files.some((file) => file.name === historyFile[vendor])) throw new Error(`The page's public history did not answer; there is no ${labels[vendor]} history to bring in.`);
  let page: ReturnType<typeof parseStatusFeeds>;
  try { page = parseStatusFeeds(vendor, input.publicUrl, files); }
  catch { throw new Error(`These are not ${labels[vendor]} public feeds, or one of them is incomplete.`); }
  const artifacts = files.map(artifact);
  const origin = (name: string) => artifacts.find((entry) => entry.name === name)!;
  const componentsFile = vendor === "statuspage" ? "public-summary.json" : vendor === "instatus" ? "public-components.json" : "public-index.json";
  const records: SourceRecord[] = [], origins = new Map<string, SourceArtifact>(), accounting: Accounting[] = [], publicAddresses: Record<string, string[]> = {};
  function add(kind: string, sourceId: string, raw: unknown, from: SourceArtifact) {
    const payload = JSON.parse(JSON.stringify(raw ?? null)) as Json;
    records.push({ namespace: vendor, kind, sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: from.sha256, location: { artifact: from.name } });
    origins.set(`${kind}:${sourceId}`, from);
  }

  // The owner's choice at setup: which of the page's components come, named as they named them, in their order.
  const byId = new Map(page.components.map((component) => [component.id, component]));
  const kept = (input.components ?? page.components.map(({ id, name }) => ({ id, name }))).filter((choice) => byId.has(choice.id));
  const keptIds = new Set(kept.map((choice) => choice.id));
  const historyOrigin = (incident: StatusFeedIncident) => origin(vendor === "betterstack" && !(incident.raw as { report?: unknown }).report ? "public-feed.rss" : historyFile[vendor]);
  const incidents = page.incidents.filter((incident) => {
    if (!incident.components.length || incident.components.some((id) => keptIds.has(id))) return true;
    // An incident about components the owner left out is theirs to leave out too.
    add("incident", incident.id, incident.raw, historyOrigin(incident));
    accounting.push({ kind: "incident", sourceId: incident.id, name: incident.title, outcome: "skipped", reason: "Every component it names was left out of this page at setup." });
    return false;
  });

  const groups: SourceGroup[] = page.groups.flatMap((group, position) => {
    const members = kept.filter((choice) => byId.get(choice.id)!.groupId === group.id).map((choice) => choice.id);
    if (!members.length) return [];
    add("group", group.id, group.raw, origin(componentsFile));
    return [{ id: group.id, name: group.name, description: null, components: members, position, created_at: members.flatMap((id) => byId.get(id)!.createdAt ?? []).sort()[0] ?? EPOCH }];
  });
  const components: SourceComponent[] = kept.map((choice, position) => {
    const component = byId.get(choice.id)!;
    add("component", component.id, component.raw, origin(componentsFile));
    // A page's current state is not history: imported components start Operational, and only past incidents claim states.
    // Statuspage says when each began; the others do not, so Lamp's record of theirs begins with the import.
    return { id: component.id, name: choice.name.trim() || component.name, description: component.description, group_id: groups.some((group) => group.id === component.groupId) ? component.groupId : null, position, status: "operational", only_show_if_degraded: component.onlyShowIfDegraded, created_at: component.createdAt ?? "" };
  });
  const sourceIncidents = incidents.map((incident): SourceIncident => {
    add("incident", incident.id, incident.raw, historyOrigin(incident));
    if (incident.url && vendor !== "statuspage") publicAddresses[`incident:${incident.id}`] = [incident.url];
    return sourceIncident(incident, keptIds);
  });
  const data: SourceData = { groups, components, incidents: sourceIncidents, maintenance: [], subscribers: [], publicFeed: true };
  return { namespace: vendor, records, artifacts, data, origins, accounting, publicAddresses, sourceInfo: { label: labels[vendor], pageId: page.pageId ?? page.host, publicUrl: page.url } };
}

/** One past incident in the shape Move in plans: its updates keep their times, and only the states they state. */
function sourceIncident(incident: StatusFeedIncident, kept: Set<string>): SourceIncident {
  let lifecycle: SourceUpdate["status"] = "investigating";
  const updates = incident.updates.map((update): SourceUpdate => {
    // An update that names no lifecycle continues the one before it.
    if (update.status !== "update") lifecycle = update.status;
    return { id: update.id, status: lifecycle, body: update.body, created_at: update.at, display_at: update.at, affected_components: update.states.filter((state) => kept.has(state.componentId)).map((state) => ({ code: state.componentId, new_status: state.state })) };
  });
  return {
    id: incident.id, name: incident.title, status: "resolved", ...(incident.impact ? { impact: incident.impact } : {}),
    created_at: incident.startedAt, resolved_at: incident.resolvedAt,
    components: incident.components.filter((id) => kept.has(id)).map((id) => ({ id })),
    incident_updates: updates,
  };
}
