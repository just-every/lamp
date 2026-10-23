import { canonicalJson, sha256 } from "../../../../../modules/import-kit/src/d1/index.ts";
import type { Json, SourceRecord, SourceArtifact } from "../../../../../modules/import-kit/src/types.ts";
import type { ReadSource, SavedFile, SourceData, SourceIncident } from "../source";
import { readStatusioFiles } from "./saved";
import { pairId, statuses, statusioGroups } from "./groups";

const lifecycles = { 100: "investigating", 200: "identified", 300: "monitoring", 400: "resolved" } as const;

export async function readStatusioResponses(files: SavedFile[], input: { pageId?: string; publicAccessAcknowledged?: boolean }): Promise<ReadSource> {
  const saved = await readStatusioFiles(files, input.pageId ?? "");
  if (!input.publicAccessAcknowledged) throw new Error("Confirm that this Status.io page and all supplied history are published and unrestricted; its API cannot establish private-page access.");
  const structure = statusioGroups(saved.components, saved.summary);
  const data: SourceData = { ...structure, publicFeed: true, incidents: [], maintenance: [], subscribers: [] };
  const records: SourceRecord[] = [], origins = new Map<string, SourceArtifact>();
  function retain(kind: string, sourceId: string, value: unknown, name: string) {
    const artifact = saved.artifacts.find(item => item.name === name)!;
    // Retain only the normalized facts. Provider messages may contain operator
    // names, IPs and capabilities that have no purpose in an import journal.
    const payload = JSON.parse(JSON.stringify(value)) as Json;
    origins.set(kind + ":" + sourceId, artifact);
    records.push({ namespace: "statusio", kind, sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: artifact.sha256, location: { artifact: name } });
  }
  for (const row of data.groups) retain("group", row.id, row, "statusio-components.json");
  for (const row of data.components) retain("component", row.id, row, "statusio-components.json");
  function history(row: typeof saved.incidents.active_incidents[number], lifecycle?: SourceIncident["status"]): SourceIncident {
    if (!row.messages.length || new Set(row.messages.map(item => item._id)).size !== row.messages.length) throw new Error("Status.io history needs uniquely identified messages.");
    const pairs = row.infrastructure_affected.map(item => pairId(item.component._id, item.container._id));
    const affected = pairs.length ? pairs : row.components_affected.map(item => item._id);
    if (affected.some(id => !data.components.some(component => component.id === id))) throw new Error("Status.io affected infrastructure cannot be matched without broadening it.");
    const updates = row.messages.map(update => {
      if (update.statuspage !== input.pageId || (update.incident ?? update.maintenance) !== row._id) throw new Error("A Status.io message belongs to another page or incident.");
      if (!statuses[update.status]) throw new Error("Status.io history contains an unsupported component state.");
      const selected = affected.filter(id => {
        const source = data.components.find(component => component.id === id)!;
        return update.components.includes(source.group_id ?? id) && (!source.group_id || update.containers.some(container => pairId(source.group_id!, container) === id));
      });
      return { id: row._id + "-" + update._id, status: lifecycles[update.state], body: update.details, created_at: update.datetime, affected_components: selected.map(code => ({ code, new_status: statuses[update.status] })) };
    });
    const last = [...updates].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1)!;
    return { id: row._id, name: row.name, status: lifecycle ?? last.status, created_at: row.datetime_open, components: affected.map(id => ({ id })), incident_updates: updates };
  }
  for (const [rows, resolved] of [[saved.incidents.active_incidents, false], [saved.incidents.resolved_incidents, true]] as const) for (const row of rows) {
    const incident = history(row, resolved ? "resolved" : undefined);
    if (resolved && !incident.incident_updates.some(update => update.status === "resolved")) throw new Error("A resolved Status.io incident has no resolution message time; no timestamp was invented.");
    data.incidents.push(incident); retain("incident", row._id, incident, "statusio-incidents.json");
  }
  for (const { row, collection, name } of saved.maintenance) {
    const window = history({ ...row, kind: "incident" });
    window.status = collection === "resolved_maintenances" ? "completed" : collection === "active_maintenances" ? "in_progress" : "scheduled";
    window.scheduled_for = row.datetime_planned_start; window.scheduled_until = row.datetime_planned_end;
    window.incident_updates = window.incident_updates.map(update => ({ ...update, status: update.status === "resolved" ? "completed" : "in_progress" }));
    data.maintenance.push(window); retain("maintenance", row._id, window, name);
  }
  return { namespace: "statusio", data, records, origins, artifacts: saved.artifacts, publicAddresses: {}, sourceInfo: { label: "Status.io", pageId: input.pageId!, publicUrl: "" } };
}
