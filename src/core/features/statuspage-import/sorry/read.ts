import { canonicalJson, sha256 } from "../../../../../modules/import-kit/src/d1/index.ts";
import type { SourceArtifact, SourceRecord } from "../../../../../modules/import-kit/src/types.ts";
import type { Accounting } from "../rows.ts";
import type { ReadSource, SavedFile, SourceData } from "../source.ts";
import { normalizeSorryComponents } from "./groups.ts";
import { retainedSorry } from "./json.ts";
import { normalizeSorryNotice } from "./notices.ts";
import { accessFields, agree, readSorryFiles } from "./saved.ts";
import { noticeSchema, publicUrl, updateSchema, type ObjectValue } from "./schema.ts";

function restricted(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(restricted);
  if (!value || typeof value !== "object") return false;
  const raw = value as ObjectValue;
  if (raw.private === true || raw.password_enabled === true || raw.sso_enabled === true || raw.published === false || raw.draft === true || raw.access_mode && !["public", "unrestricted"].includes(String(raw.access_mode)) || ["audiences", "audience_ids", "allowed_ips", "ip_allowlist"].some((field) => Array.isArray(raw[field]) ? (raw[field] as unknown[]).length > 0 : Boolean(raw[field]))) return true;
  return Object.values(raw).some(restricted);
}

export interface SorryRead extends ReadSource {
  namespace: "sorry";
  accounting: Accounting[];
  publicAddresses: Record<string, string[]>;
  sourceInfo: { label: string; pageId: string; publicUrl: string };
}
export interface SorryReadOptions { pageId?: string; publicAccessAcknowledged?: boolean; publicUrl?: string; allowPartialPreview?: boolean }

/** Public snapshots have no subscriber authority. Both modes require owner
 * confirmation of unrestricted publication; authentication never implies it. */
export async function readSorryResponses(files: SavedFile[], options: SorryReadOptions = {}): Promise<SorryRead> {
  const saved = await readSorryFiles(files, options.pageId, options.publicUrl);
  if (!options.publicAccessAcknowledged) throw new Error("Confirm that this Sorry page and all supplied history are published and unrestricted, without private access or visitor SSO.");
  if (restricted(saved.page) || [...saved.components, ...saved.notices, ...saved.details.values()].some(({ raw }) => restricted(raw)) || [...saved.updates.values()].flat().some(({ raw }) => restricted(raw))) throw new Error("Private, unpublished, password-protected or audience-scoped Sorry history cannot become a public Lamp page.");
  const records: SourceRecord[] = [], accounting: Accounting[] = [];
  const origins = new Map<string, SourceArtifact>();
  const publicAddresses: Record<string, string[]> = {};
  const normalized = normalizeSorryComponents(saved.components.map(({ raw }) => raw), accounting);
  const data: SourceData = { ...normalized, incidents: [], maintenance: [], subscribers: [] };
  const components = new Set(data.components.map((row) => row.id));
  function add(kind: string, sourceId: string, raw: unknown, origin: SourceArtifact) {
    const payload = retainedSorry(raw);
    records.push({ namespace: "sorry", kind, sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: origin.sha256, location: { artifact: origin.name } });
    origins.set(`${kind}:${sourceId}`, origin);
  }
  for (const { raw, origin } of saved.components) {
    add("component", raw.id, raw, origin);
    if (data.groups.some((group) => group.id === raw.id)) add("group", raw.id, raw, origin);
  }
  for (const { raw: list, origin } of saved.notices) {
    const kind = list.type === "planned" ? "maintenance" : "incident";
    const detail = saved.details.get(list.id);
    if (!detail) {
      if (!options.allowPartialPreview) throw new Error("Every Sorry notice requires its complete saved detail and update history; capture every detail before importing.");
      add(kind, list.id, list, origin);
      accounting.push({ kind, sourceId: list.id, name: list.subject, outcome: "rejected", reason: "Detail not captured in this preview; import requires every notice detail." });
      continue;
    }
    const row = noticeSchema.parse(detail.raw);
    agree(list, row, accessFields);
    const history = saved.updates.get(list.id)!;
    const updates = history.map(({ raw }) => updateSchema.parse(raw));
    const parsedUpdates = row.updates ?? updates;
    // Retain list facts as well: detail omissions must not discard supplied metadata.
    add(kind, row.id, { ...row, list, updates: parsedUpdates }, detail.origin);
    const addresses = [...new Set([list.url, list.link, row.url, row.link].filter((value): value is string => Boolean(value)))];
    for (const address of addresses) publicUrl(address);
    if (addresses.length) {
      publicAddresses[`${kind}:${row.id}`] = [...new Set(addresses.flatMap((address) => [address, new URL(`/notices/${row.id}`, address).href]))];
    }
    const incident = normalizeSorryNotice(row, parsedUpdates, saved.isPublic, components, accounting);
    if (incident) (kind === "maintenance" ? data.maintenance : data.incidents).push(incident);
  }
  for (const { raw: row, origin } of saved.subscribers) {
    add("subscriber", row.id, row, origin);
    const selected = row.components?.map((component) => component.id) ?? row.component_ids;
    let reason: string | undefined;
    const otherChannels = Object.entries(row).filter(([key, value]) => key.startsWith("notify_by_") && key !== "notify_by_email" && value === true).map(([key]) => key.replace("notify_by_", ""));
    if (!row.notify_by_email || !row.email) reason = "Sorry subscription has no enabled email channel; no subscriber was created.";
    else if (otherChannels.length) reason = `Sorry ${otherChannels.join(" / ")} subscription is unsupported; only email-only subscriptions can move.`;
    else if (row.confirmed === false || row.verified === false || row.email_verified === false || row.unsubscribed === true || row.unsubscribed_at || row.deleted_at || row.deactivated_at) reason = "Sorry subscription is explicitly unconfirmed, unsubscribed or inactive; consent was not carried.";
    else if (!selected || selected.some((id) => !components.has(id))) reason = "Sorry component preferences are absent or unresolved; importing would broaden the subscription.";
    else if (row.components && row.component_ids && canonicalJson([...selected].sort()) !== canonicalJson([...row.component_ids].sort())) reason = "Sorry subscription component_ids and included components disagree.";
    if (reason) { accounting.push({ kind: "subscriber", sourceId: row.id, name: "Sorry subscriber", outcome: "skipped", reason }); continue; }
    data.subscribers.push({ id: row.id, mode: "email", email: row.email, components: [...new Set(selected!)] });
    accounting.push({ kind: "subscriber", sourceId: row.id, name: "Sorry subscriber", outcome: "changed", reason: "Documented enabled email preference retained for an owner-released confirmation invitation; no active subscription or notification is created by import." });
  }
  return { namespace: "sorry", records, artifacts: saved.artifacts, data, origins, accounting, publicAddresses,
    sourceInfo: { label: "Sorry", pageId: saved.page.id ?? options.pageId ?? new URL(saved.pageUrl).hostname, publicUrl: saved.pageUrl } };
}
