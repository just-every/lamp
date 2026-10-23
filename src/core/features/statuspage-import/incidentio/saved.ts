import { canonicalJson, sha256 } from "../../../../../modules/import-kit/src/d1/index.ts";
import type { Json, SourceArtifact } from "../../../../../modules/import-kit/src/types.ts";
import type { SavedFile } from "../source";
import { id, limits, schemas } from "./schema";

function restricted(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(restricted);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    (["private", "customer_page", "password_enabled", "password_protected", "restricted", "hidden"].includes(key) && child != null && child !== false) ||
    (["audiences", "audience_groups", "allowlist", "ip_restrictions"].includes(key) && Boolean(Array.isArray(child) ? child.length : child)) ||
    (["published", "is_published"].includes(key) && child != null && child !== true) ||
    (key === "draft" && child != null && child !== false) || restricted(child));
}

export async function readIncidentioFiles(files: SavedFile[], pageId: string) {
  if (!id.safeParse(pageId).success) throw new Error("Enter the incident.io status page ID for these saved responses.");
  if (!files.length || files.length > limits.files) throw new Error("Choose between 1 and 200 saved incident.io response files.");
  const values = new Map<string, unknown>(), artifacts: SourceArtifact[] = [];
  let bytes = 0, count = 0;
  for (const file of files) {
    if (values.has(file.name)) throw new Error("Duplicate incident.io response filename.");
    if (!/^incidentio-(page|structure|components|(?:incidents|maintenances)(?:-[1-9][0-9]?)?)\.json$/u.test(file.name)) throw new Error("Unsupported saved incident.io response filename.");
    const size = new TextEncoder().encode(file.text).length; bytes += size;
    if (bytes > limits.maxBytes) throw new Error("Saved incident.io responses exceed the 8 MiB limit.");
    let value: unknown;
    try { value = JSON.parse(file.text); } catch { throw new Error("An incident.io response contains invalid JSON."); }
    if (restricted(value)) throw new Error("incident.io private, customer, hidden or audience-scoped sources cannot become a public Lamp page.");
    function bound(raw: unknown) {
      if (Array.isArray(raw)) { for (const child of raw) bound(child); return; }
      if (!raw || typeof raw !== "object") return;
      if (++count > limits.maxRecords || (("id" in raw || "_id" in raw) && new TextEncoder().encode(canonicalJson(raw as Json)).length > limits.maxRecordBytes)) throw new Error("incident.io record count or record size limit exceeded.");
      for (const child of Object.values(raw)) bound(child);
    }
    bound(value); values.set(file.name, value); artifacts.push({ name: file.name, sha256: sha256(file.text), size });
  }
  function parse<K extends keyof typeof schemas>(name: string, kind: K): ReturnType<(typeof schemas)[K]["parse"]> {
    try { return schemas[kind].parse(values.get(name)) as ReturnType<(typeof schemas)[K]["parse"]>; }
    catch { throw new Error(name + ": include the unchanged documented incident.io response."); }
  }
  const page = parse("incidentio-page.json", "page").status_page;
  if (page.id !== pageId) throw new Error("The incident.io page response belongs to another page.");
  const catalogue = parse("incidentio-components.json", "components").status_page_components;
  if (new Set(catalogue.map(row => row.id)).size !== catalogue.length) throw new Error("incident.io repeats a catalogue component identity.");
  const structure = parse("incidentio-structure.json", "structure");
  const used = new Set(["incidentio-page.json", "incidentio-components.json", "incidentio-structure.json"]);
  function list<K extends "incidents" | "maintenances">(kind: K) {
    // Parse each collection explicitly to retain the schema's discriminated rows.
    const rows: Array<{ row: unknown; name: string }> = [], ids = new Set<string>(), cursors = new Set<string>();
    for (let number = 1; number <= limits.pages; number++) {
      const name = "incidentio-" + kind + (number === 1 ? "" : "-" + number) + ".json";
      const response = parse(name, kind);
      used.add(name);
      const collection = kind === "incidents" ? (response as ReturnType<typeof schemas.incidents.parse>).status_page_incidents : (response as ReturnType<typeof schemas.maintenances.parse>).status_page_maintenances;
      if (collection.length > response.pagination_meta.page_size) throw new Error("incident.io response exceeds its declared page size.");
      for (const row of collection) {
        if (row.status_page_id !== pageId || ids.has(row.id)) throw new Error("incident.io history belongs to another page or repeats an identity.");
        ids.add(row.id); rows.push({ row, name });
      }
      const next = response.pagination_meta.after;
      if (!next) return rows;
      if (cursors.has(next)) throw new Error("incident.io pagination repeated a cursor.");
      cursors.add(next);
    }
    throw new Error("incident.io pagination exceeds the bounded page limit; no partial history was imported.");
  }
  const incidents = list("incidents").map(item => ({ ...item, row: schemas.incidents.shape.status_page_incidents.element.parse(item.row) }));
  const maintenances = list("maintenances").map(item => ({ ...item, row: schemas.maintenances.shape.status_page_maintenances.element.parse(item.row) }));
  if ([...values.keys()].some(name => !used.has(name))) throw new Error("incident.io saved pagination has extra or nonconsecutive pages.");
  return { page, catalogue, structure, incidents, maintenances, artifacts };
}
