import { desc, inArray, isNull } from "drizzle-orm";
import { createDatabase } from "../../platform/db/client";
import { incidents, incidentComponents, incidentUpdates, incidentInternalNotes } from "../../shared/schema";
import type { ComponentState } from "../../shared/domain";
import type { PublishingDraft } from "./repository";

export type DraftRow = Omit<PublishingDraft, "scheduledChannels" | "componentChanges"> & { scheduledChannelsJson: string | null; componentChangesJson: string; agentPreparationJson?: string | null };

export function publishingDraft(row: DraftRow | null): PublishingDraft | null {
  if (!row) return null;
  let candidate: unknown;
  try { candidate = JSON.parse(row.scheduledChannelsJson ?? "[]"); }
  catch { throw new Error("Scheduled delivery channel configuration is malformed."); }
  if (!Array.isArray(candidate) || candidate.some(item => item !== "email" && item !== "webhook" && item !== "chat" && item !== "sms")) throw new Error("Scheduled delivery channel configuration is invalid.");
  const componentChanges = JSON.parse(row.componentChangesJson);
  if (!Array.isArray(componentChanges)) throw new Error("Draft component changes are malformed.");
  return { ...row, agentPreparation: row.agentPreparationJson ? JSON.parse(row.agentPreparationJson) : null, componentChanges, scheduledChannels: [...new Set(candidate)] };
}

function byIncident<T extends { incidentId: string }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const values = result.get(row.incidentId) ?? [];
    values.push(row);
    result.set(row.incidentId, values);
  }
  return result;
}

// A fixed number of fresh collection reads instead of five reads per incident.
// Subqueries restrict children to the same undeleted collection as the list.
export async function listIncidentRelations(binding: D1Database) {
  const db = createDatabase(binding);
  const visible = db.select({ id: incidents.id }).from(incidents).where(isNull(incidents.deletedAt));
  const [components, updates, notes, drafts, impacts] = await Promise.all([
    db.select().from(incidentComponents).where(inArray(incidentComponents.incidentId, visible)).all(),
    db.select().from(incidentUpdates).where(inArray(incidentUpdates.incidentId, visible)).orderBy(desc(incidentUpdates.publishedAt)).all(),
    db.select().from(incidentInternalNotes).where(inArray(incidentInternalNotes.incidentId, visible)).orderBy(desc(incidentInternalNotes.createdAt)).all(),
    binding.prepare(`SELECT d.id, d.incident_id AS incidentId, d.lifecycle, d.affected_audience AS affectedAudience, d.customer_impact AS customerImpact, d.what_still_works AS whatStillWorks, d.details, d.next_update_at AS nextUpdateAt, d.author_operator_id AS authorOperatorId, d.created_at AS createdAt, d.updated_at AS updatedAt, d.scheduled_publish_at AS scheduledPublishAt, d.scheduled_channels_json AS scheduledChannelsJson, d.reviewed_by_operator_id AS reviewedByOperatorId, d.reviewed_at AS reviewedAt, d.corrects_update_id AS correctsUpdateId, d.component_changes_json AS componentChangesJson,(SELECT preparation_json FROM incident_agent_draft_preparations WHERE draft_id=d.id AND active=1) AS agentPreparationJson FROM incident_drafts d JOIN incidents i ON i.id=d.incident_id WHERE i.deleted_at IS NULL`).all<DraftRow>(),
    binding.prepare("SELECT id, peak_impact AS peakImpact FROM incidents WHERE deleted_at IS NULL").all<{ id: string; peakImpact: ComponentState | null }>(),
  ]);
  return {
    components: byIncident(components), updates: byIncident(updates), notes: byIncident(notes),
    drafts: new Map(drafts.results.map(row => [row.incidentId, publishingDraft(row)])),
    impacts: new Map(impacts.results.map(row => [row.id, row.peakImpact])),
  };
}
