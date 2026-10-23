import { canonicalJson, sha256 } from "../../../../../modules/import-kit/src/d1/index.ts";
import type { Json, SourceArtifact } from "../../../../../modules/import-kit/src/types.ts";
import type { SavedFile } from "../source";
import { id, limits, schemas } from "./schema";

/** Inspect restrictions before reducing records to their documented fields.
 * The API omits private-page flags: the separate owner acknowledgment is still
 * required, even with an empty IP access list. */
export function restricted(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(restricted);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    (["private", "password_enabled", "password_protected", "restricted", "hidden", "useAllowList"].includes(key) && child !== false && child != null) ||
    (["audiences", "audienceGroups", "allowList", "ip_allowlist"].includes(key) && Boolean(Array.isArray(child) ? child.length : child)) ||
    (["published", "isPublished", "shouldPublish"].includes(key) && child !== true && child != null) ||
    (key === "draft" && child !== false && child != null) || restricted(child));
}

export async function readStatusioFiles(files: SavedFile[], pageId: string) {
  if (!id.safeParse(pageId).success) throw new Error("Enter the Status.io status page ID for these responses.");
  if (!files.length || files.length > limits.files) throw new Error("Choose between 1 and 200 saved Status.io response files.");
  const values = new Map<string, unknown>(), artifacts: SourceArtifact[] = [];
  let bytes = 0, records = 0;
  for (const file of files) {
    if (values.has(file.name)) throw new Error("Duplicate Status.io response filename.");
    if (!/^statusio-(components|summary|incidents|maintenances|acl|maintenance-[A-Za-z0-9_-]+)\.json$/u.test(file.name)) throw new Error("Unsupported saved Status.io response filename.");
    bytes += new TextEncoder().encode(file.text).length;
    if (bytes > limits.maxBytes) throw new Error("Saved Status.io responses exceed the 8 MiB limit.");
    let value: unknown;
    try { value = JSON.parse(file.text); } catch { throw new Error("A saved Status.io response contains invalid JSON."); }
    if (restricted(value)) throw new Error("Status.io private, password-protected, IP-restricted or audience-scoped pages and history cannot become a public Lamp page.");
    // Bound all source objects and nested messages, not just top-level lists.
    function count(raw: unknown) {
      if (Array.isArray(raw)) { for (const child of raw) count(child); return; }
      if (!raw || typeof raw !== "object") return;
      if (++records > limits.maxRecords || new TextEncoder().encode(canonicalJson(raw as Json)).length > limits.maxRecordBytes) throw new Error("Status.io record count or record size limit exceeded.");
      for (const child of Object.values(raw)) count(child);
    }
    count(value);
    values.set(file.name, value);
    artifacts.push({ name: file.name, sha256: sha256(file.text), size: new TextEncoder().encode(file.text).length });
  }
  function read<K extends keyof typeof schemas>(name: string, schema: K) {
    try { return schemas[schema].parse(values.get(name)).result; }
    catch { throw new Error(name + ": include the unchanged documented Status.io response; its shape or API result was refused."); }
  }
  const components = read("statusio-components.json", "components") as ReturnType<typeof schemas.components.parse>["result"];
  const summary = read("statusio-summary.json", "summary") as ReturnType<typeof schemas.summary.parse>["result"];
  const incidents = read("statusio-incidents.json", "incidents") as ReturnType<typeof schemas.incidents.parse>["result"];
  const maintenanceIds = read("statusio-maintenances.json", "maintenances") as ReturnType<typeof schemas.maintenances.parse>["result"];
  const acl = read("statusio-acl.json", "acl") as ReturnType<typeof schemas.acl.parse>["result"];
  if (acl.ipv4.trim() || acl.ipv6.trim()) throw new Error("Status.io IP-restricted pages cannot become a public Lamp page.");
  if (incidents.active_incidents.length + incidents.resolved_incidents.length >= 100) throw new Error("The deprecated Status.io incident list may be truncated at 100; this import was refused. Modern history pagination is not documented.");
  const used = new Set(["statusio-components.json", "statusio-summary.json", "statusio-incidents.json", "statusio-maintenances.json", "statusio-acl.json"]);
  const maintenance = Object.entries(maintenanceIds).flatMap(([collection, ids]) => ids.map(sourceId => {
    const name = "statusio-maintenance-" + sourceId + ".json";
    used.add(name);
    const row = read(name, "maintenance") as ReturnType<typeof schemas.maintenance.parse>["result"];
    if (row._id !== sourceId) throw new Error("Status.io maintenance detail identity differs from its list.");
    return { row, collection, name };
  }));
  if ([...values.keys()].some(name => !used.has(name))) throw new Error("A Status.io maintenance detail is absent from its enumeration.");
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(components.map(row => row._id)) || !unique(summary.status.map(row => row.id)) || !unique([...incidents.active_incidents, ...incidents.resolved_incidents].map(row => row._id)) || !unique(maintenance.map(({ row }) => row._id))) throw new Error("Status.io responses repeat a source identity.");
  for (const row of [...components, ...incidents.active_incidents, ...incidents.resolved_incidents, ...maintenance.map(item => item.row)]) if (row.statuspage !== pageId) throw new Error("A Status.io record belongs to another status page.");
  return { components, summary, incidents, maintenance, artifacts };
}
