import type { StoredIncidentComponent } from "./repository";
import { COMPONENT_STATE_SEVERITY } from "../../shared/domain";

export type AttachedIncidentComponent = Omit<StoredIncidentComponent, "publishedAt">;

// These statements execute inside the caller's atomic attachment/template batch.
export function attachClaimStatements(binding: D1Database, claim: AttachedIncidentComponent): D1PreparedStatement[] {
  return [
    binding.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM components WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM incident_components WHERE incident_id = ? AND component_id = ?) THEN 1 ELSE json('Component is missing or already attached') END`).bind(claim.componentId,claim.incidentId,claim.componentId),
    binding.prepare(`INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at)
      SELECT ?,i.id,c.id,c.name,?,?,CASE WHEN EXISTS (SELECT 1 FROM incident_updates u WHERE u.incident_id = i.id) THEN ? ELSE NULL END,?,?
      FROM incidents i JOIN components c ON c.id = ? WHERE i.id = ? AND i.deleted_at IS NULL AND i.lifecycle <> 'Resolved'`)
      .bind(claim.id,claim.state,claim.relationship,claim.createdAt,claim.createdAt,claim.updatedAt,claim.componentId,claim.incidentId),
    binding.prepare(`INSERT INTO component_claim_events (id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at)
      SELECT ?,component_id,'incident',incident_id,state,?,?,? FROM incident_components WHERE id = ? AND published_at IS NOT NULL`)
      .bind(claim.id,claim.createdAt,claim.createdAt,claim.updatedAt,claim.id),
    binding.prepare(`UPDATE incidents SET peak_impact = (
      SELECT value FROM json_each(?) WHERE value = incidents.peak_impact OR value = ? ORDER BY key LIMIT 1
    ) WHERE id = ? AND EXISTS (SELECT 1 FROM incident_components WHERE id = ? AND published_at IS NOT NULL)`)
      .bind(JSON.stringify(COMPONENT_STATE_SEVERITY),claim.state,claim.incidentId,claim.id),
  ];
}

/** Reject stale claims before any publication write, including a detach/reattach
 * of the same component. The row IDs identify the exact attachment reviewed. */
export function publicationComponentsGuard(binding: D1Database, incidentId: string, components: Pick<StoredIncidentComponent, "id" | "componentId" | "state">[]): D1PreparedStatement {
  const snapshot = JSON.stringify(components.map(({ id, componentId, state }) => ({ id, componentId, state })));
  return binding.prepare(`SELECT CASE WHEN
    EXISTS (SELECT 1 FROM incidents WHERE id = ? AND deleted_at IS NULL)
    AND json_array_length(?) > 0
    AND (SELECT count(*) FROM incident_components WHERE incident_id = ?) = json_array_length(?)
    AND NOT EXISTS (SELECT 1 FROM incident_components current WHERE current.incident_id = ? AND NOT EXISTS (
      SELECT 1 FROM json_each(?) expected WHERE json_extract(expected.value,'$.id') = current.id
        AND json_extract(expected.value,'$.componentId') IS current.component_id AND json_extract(expected.value,'$.state') = current.state
    )) THEN 1 ELSE json('Incident components changed') END`)
    .bind(incidentId,snapshot,incidentId,snapshot,incidentId,snapshot);
}

export function activeIncidentGuard(binding: D1Database, incidentId: string): D1PreparedStatement {
  return binding.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM incidents WHERE id = ? AND deleted_at IS NULL AND lifecycle <> 'Resolved') THEN 1 ELSE json('Incident is missing or resolved') END`).bind(incidentId);
}

export async function writeClaimBatch(binding: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  try { await binding.batch(statements); }
  catch (cause) {
    if (cause instanceof Error && cause.message.includes("malformed JSON")) throw new Error("The incident or its affected components changed. Refresh and try again.");
    throw cause;
  }
}
