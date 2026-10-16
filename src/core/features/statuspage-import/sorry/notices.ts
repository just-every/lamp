import type { Accounting } from "../rows.ts";
import type { SourceIncident, SourceUpdate } from "../source.ts";
import { canonicalJson, sha256 } from "../../../../../modules/import-kit/src/d1/index.ts";
import type { Json } from "../../../../../modules/import-kit/src/types.ts";
import type { SorryNotice, SorryUpdate } from "./schema.ts";

const incidentStates = { investigating: "investigating", identified: "identified", recovering: "monitoring", resolved: "resolved", false_alarm: "resolved" } as const;
const maintenanceStates = { scheduled: "scheduled", underway: "in_progress", complete: "completed", cancelled: "completed" } as const;

/** A management update doesn't document authored lifecycle. Text/time remain
 * exact; incident impact is bounded separately by the notice's began/ended times. */
export function normalizeSorryNotice(row: SorryNotice, updates: SorryUpdate[], isPublic: boolean, componentIds: Set<string>, accounting: Accounting[]): SourceIncident | undefined {
  const kind = row.type === "planned" ? "maintenance" : "incident";
  const refuse = (reason: string) => { accounting.push({ kind, sourceId: row.id, name: row.subject, outcome: "rejected", reason }); return undefined; };
  const selected = row.components?.map((component) => component.id) ?? row.component_ids;
  if (!selected) return refuse("Sorry affected component history is absent; capture notice details with include=components,updates.");
  if (row.components && row.component_ids && canonicalJson([...selected].sort()) !== canonicalJson([...row.component_ids].sort())) return refuse("Sorry component_ids and included components disagree.");
  if (selected.some((id) => !componentIds.has(id))) return refuse("A Sorry affected component is absent from the saved component list.");
  if (!updates.length) return refuse("Sorry notice has no progress update history; no publication time or message was invented.");
  const ids = new Set<string>();
  let projected = false;
  const normalized: SourceUpdate[] = [];
  const ordered = [...updates].sort((a, b) => a.created_at.localeCompare(b.created_at) || (a.id ?? "").localeCompare(b.id ?? "") || a.content.localeCompare(b.content));
  for (const update of ordered) {
    const id = update.id ?? `at-${sha256(canonicalJson({ created_at: update.created_at, state: update.state ?? null, content: update.content } as Json))}`;
    if (ids.has(id)) throw new Error("Sorry notice repeats a progress update identity.");
    ids.add(id);
    let state: SourceUpdate["status"] | undefined;
    if (row.type === "general") state = "resolved";
    else if (update.state) state = row.type === "planned" ? maintenanceStates[update.state as keyof typeof maintenanceStates] : incidentStates[update.state as keyof typeof incidentStates];
    else if (!isPublic) {
      projected = true;
      if (row.type === "planned") state = row.ended_at && Date.parse(update.created_at) >= Date.parse(row.ended_at) ? "completed" : row.began_at && Date.parse(update.created_at) >= Date.parse(row.began_at) ? "in_progress" : "scheduled";
      else state = row.ended_at && Date.parse(update.created_at) >= Date.parse(row.ended_at) ? "resolved" : "investigating";
    }
    if (!state) return refuse("Sorry progress history has an unsupported or missing lifecycle state; no source state was invented.");
    normalized.push({ id: `${row.id}:${id}`, status: state, body: update.content, created_at: update.created_at, display_at: update.created_at,
      ...(row.type === "unplanned" ? { affected_components: selected.map((code) => ({ code, new_status: state === "resolved" ? "operational" as const : "degraded_performance" as const })) } : {}) });
  }
  const state = row.type === "general" ? "resolved" : row.type === "planned" ? maintenanceStates[row.state as keyof typeof maintenanceStates] : incidentStates[row.state as keyof typeof incidentStates];
  if (!state) return refuse("Sorry notice has an unsupported lifecycle state.");
  if (row.ended_at && row.began_at && Date.parse(row.ended_at) < Date.parse(row.began_at)) return refuse("Sorry notice's actual end precedes its start.");
  if (row.type === "planned" && (!row.begins_at || !row.ends_at || Date.parse(row.ends_at) <= Date.parse(row.begins_at))) return refuse("Sorry planned notice has no valid documented begins_at/ends_at window.");
  if (row.type === "unplanned" && !row.began_at) return refuse("Sorry incident has no documented began_at instant.");
  if (row.latest_update) {
    const latest = ordered.at(-1)!;
    if (row.latest_update.content !== latest.content || Date.parse(row.latest_update.created_at) !== Date.parse(latest.created_at)) throw new Error("Sorry latest_update and full progress history disagree.");
  }
  if (row.type === "general") accounting.push({ kind, sourceId: row.id, name: row.subject, outcome: "changed", reason: "General Sorry notice is carried as a resolved informational incident; its messages and original times are retained without component outage claims." });
  else if (projected) accounting.push({ kind, sourceId: row.id, name: row.subject, outcome: "changed", reason: "Sorry management updates omit authored lifecycle states. Display lifecycle is projected from documented notice start/end times; every message and publication instant is retained. Original authored lifecycle is unavailable." });
  else if (row.state === "false_alarm") accounting.push({ kind, sourceId: row.id, name: row.subject, outcome: "changed", reason: "Sorry false alarm is represented as resolved; full source history remains retained." });
  return { id: row.id, name: row.subject, status: row.type === "planned" && row.state === "cancelled" ? "cancelled" : state, impact: row.type === "general" ? "none" : row.type === "planned" ? "maintenance" : "minor",
    created_at: row.type === "planned" ? row.created_at : row.began_at ?? row.created_at,
    resolved_at: row.ended_at ?? (row.type === "general" ? ordered.at(-1)!.created_at : undefined),
    ...(row.type === "planned" ? { scheduled_for: row.begins_at, scheduled_until: row.ends_at } : {}),
    components: [...new Set(selected)].map((id) => ({ id })), incident_updates: normalized };
}
