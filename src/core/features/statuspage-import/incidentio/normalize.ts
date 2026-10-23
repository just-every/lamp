import { canonicalJson, sha256 } from "../../../../../modules/import-kit/src/d1/index.ts";
import type { Json, SourceArtifact, SourceRecord } from "../../../../../modules/import-kit/src/types.ts";
import type { ReadSource, SavedFile, SourceData } from "../source";
import type { Accounting } from "../rows";
import { readIncidentioFiles } from "./saved";
import { pageStructure } from "./structure";

const states = { operational: "operational", degraded_performance: "degraded_performance", partial_outage: "partial_outage", full_outage: "major_outage" } as const;

export async function readIncidentioResponses(files: SavedFile[], input: { pageId?: string; publicAccessAcknowledged?: boolean }): Promise<ReadSource> {
  const saved = await readIncidentioFiles(files, input.pageId ?? "");
  if (!input.publicAccessAcknowledged) throw new Error("Confirm that this incident.io page and all supplied history are public and unrestricted, with no customer or audience access restrictions; the API cannot establish that access.");
  if (saved.page.public_url) {
    const address = new URL(saved.page.public_url);
    if (address.protocol !== "https:" || address.username || address.password || address.search || address.hash) throw new Error("The incident.io public page URL is unsafe or contains access credentials.");
  }
  const data: SourceData = { ...pageStructure(saved.structure, saved.catalogue), publicFeed: true, incidents: [], maintenance: [], subscribers: [] };
  const records: SourceRecord[] = [], origins = new Map<string, SourceArtifact>(), accounting: Accounting[] = [];
  function retain(kind: string, sourceId: string, raw: unknown, name: string) {
    const artifact = saved.artifacts.find(item => item.name === name)!;
    const payload = JSON.parse(JSON.stringify(raw)) as Json;
    origins.set(kind + ":" + sourceId, artifact);
    records.push({ namespace: "incidentio", kind, sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: artifact.sha256, location: { artifact: name } });
  }
  for (const row of data.groups) retain("group", row.id, row, "incidentio-structure.json");
  for (const row of data.components) {
    retain("component", row.id, row, "incidentio-structure.json");
    accounting.push({ kind: "component", sourceId: row.id, name: row.name, outcome: "changed", reason: "Name, description and page placement carried over. The API exposes no creation time or standalone state: this catalogue record begins at import, and only explicit history states make claims." });
  }
  const components = new Set(data.components.map(row => row.id));
  for (const { row, name } of saved.incidents) {
    if (!row.updates.length || new Set(row.updates.map(update => update.id)).size !== row.updates.length) throw new Error("incident.io history needs uniquely identified published updates.");
    const affected = [...new Set([...row.component_impacts.map(item => item.component_id), ...row.updates.flatMap(update => update.component_statuses.map(item => item.component_id))])];
    if (affected.some(id => !components.has(id))) throw new Error("incident.io history names a component outside the selected public page; no selection was broadened.");
    if (row.updates.some(update => update.status_page_incident_id !== row.id)) throw new Error("An incident.io update belongs to another incident.");
    const incident = { id: row.id, name: row.name, status: row.incident_status, created_at: row.published_at, components: affected.map(id => ({ id })), incident_updates: row.updates.map(update => ({ id: row.id + "-" + update.id, status: update.incident_status, body: update.message, created_at: update.published_at, affected_components: update.component_statuses.map(item => ({ code: item.component_id, new_status: states[item.component_status] })) })) };
    if (row.incident_status === "resolved" && !row.updates.some(update => update.incident_status === "resolved")) throw new Error("A resolved incident.io incident has no resolution update time; none was invented.");
    data.incidents.push(incident); retain("incident", row.id, incident, name);
  }
  for (const { row, name } of saved.maintenances) {
    if (row.maintenance_status === "maintenance_in_progress") throw new Error("An incident.io maintenance is in progress but its original window is unavailable; this import cannot preserve the current public state.");
    // Periods are actual per-component maintenance, not the original planned
    // schedule. Publishing them as a planned window would change source facts.
    retain("maintenance", row.id, { id: row.id, name: row.name }, name);
    accounting.push({ kind: "maintenance", sourceId: row.id, name: row.name, outcome: "rejected", reason: "Not moved: incident.io's documented GET response omits the original planned maintenance window. Actual component periods cannot stand in for that window." });
  }
  return { namespace: "incidentio", data, records, origins, accounting, artifacts: saved.artifacts, publicAddresses: {}, sourceInfo: { label: "incident.io", pageId: saved.page.id, publicUrl: saved.page.public_url ?? "" } };
}
