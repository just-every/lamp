import { COMPONENT_STATE_SEVERITY } from "../../shared/domain";
import type { ComponentStateHistoryInput } from "./repository";

/** Aggregate claims and append one transition inside the caller's transaction. */
export function currentStateHistoryStatement(binding: D1Database, input: Omit<ComponentStateHistoryInput, "previousState" | "newState">) {
  return binding.prepare(`WITH claims(state) AS (
    SELECT state FROM vendor_dependencies WHERE component_id = ? AND state IS NOT NULL
    UNION ALL SELECT state FROM component_standing_claims WHERE component_id = ?
    UNION ALL SELECT attached.state FROM incident_components attached JOIN incidents incident ON incident.id = attached.incident_id
      WHERE attached.component_id = ? AND attached.published_at IS NOT NULL AND incident.deleted_at IS NULL AND incident.lifecycle <> 'Resolved'
    UNION ALL SELECT attached.state FROM maintenance_components attached JOIN maintenance window ON window.id = attached.maintenance_id
      WHERE attached.component_id = ? AND window.state = 'In progress'
  ), current AS (
    SELECT value AS state FROM json_each(?) WHERE value = 'Operational' OR value IN (SELECT state FROM claims) ORDER BY key LIMIT 1
  ), previous AS (
    SELECT new_state AS state FROM component_state_history WHERE component_id = ? ORDER BY changed_at DESC,created_at DESC,id DESC LIMIT 1
  ) INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at)
    SELECT ?,?,COALESCE((SELECT state FROM previous),'Operational'),current.state,?,?,?,?,?,? FROM current
    WHERE COALESCE((SELECT state FROM previous),'Operational') IS NOT current.state AND EXISTS (SELECT 1 FROM components WHERE id = ?)
    RETURNING previous_state AS previousState,new_state AS newState`)
    .bind(input.componentId,input.componentId,input.componentId,input.componentId,JSON.stringify(COMPONENT_STATE_SEVERITY),input.componentId,
      input.id,input.componentId,input.cause.type,input.cause.id,input.cause.operatorId,input.changedAt,input.createdAt,input.updatedAt,input.componentId);
}
