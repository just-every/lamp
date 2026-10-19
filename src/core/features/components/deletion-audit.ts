import { createUlid } from "../../shared/ids";

/** One attributed audit entry for a component or group deletion (TEAM-007). Batch it
 * before the DELETE so the entry and the deletion commit together, and only when the
 * record still exists. */
export function deletionAudit(binding: D1Database, kind: "component" | "component-group", id: string, operatorId: string, at: string) {
  const table = kind === "component" ? "components" : "component_groups";
  return binding.prepare(`INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) SELECT ?, '${kind}', id, 'deleted', ?, json_object('name', name), ?, ? FROM ${table} WHERE id = ?`)
    .bind(createUlid(), operatorId, at, at, id);
}
