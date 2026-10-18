import { createUlid } from "../../shared/ids";
import type { GroupedReading } from "./grouped-alerts";
import type { AlertReceiptRow } from "./repository";

/** These statements join the receipt's batch: a group, its members and private
 * component attachments cannot land independently. */
export function groupedReceiptStatements(binding: D1Database, receipt: AlertReceiptRow, group: GroupedReading): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const member of group.alerts) {
    statements.push(binding.prepare(`INSERT INTO alert_group_members (source_id,incident_id,group_key,fingerprint,state,received_at,recovered_at)
      SELECT ?,incident_id,?,?,?,?,? FROM alert_receipts WHERE id = ? AND incident_id IS NOT NULL
      ON CONFLICT(source_id,incident_id,group_key,fingerprint) DO UPDATE SET state=excluded.state,received_at=excluded.received_at,recovered_at=excluded.recovered_at`)
      .bind(receipt.sourceId, group.key, member.fingerprint, member.state, receipt.receivedAt, member.state === "resolved" ? receipt.receivedAt : null, receipt.id));
    if (member.state !== "firing") continue;
    for (const componentId of member.componentIds) {
      statements.push(binding.prepare(`INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,created_at,updated_at,published_at)
        SELECT ?,r.incident_id,c.id,c.name,'Major outage','Primary',?,?,NULL FROM alert_receipts r JOIN components c ON c.id = ?
        WHERE r.id = ? AND r.incident_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM incident_components ic WHERE ic.incident_id = r.incident_id AND ic.component_id = c.id)`)
        .bind(createUlid(), receipt.receivedAt, receipt.receivedAt, componentId, receipt.id));
    }
  }
  statements.push(binding.prepare(`UPDATE alert_receipts SET state = CASE WHEN EXISTS (
    SELECT 1 FROM alert_group_members m WHERE m.incident_id = alert_receipts.incident_id AND m.state = 'firing'
  ) THEN 'firing' ELSE 'recovered' END, recovered_at = CASE WHEN EXISTS (
    SELECT 1 FROM alert_group_members m WHERE m.incident_id = alert_receipts.incident_id AND m.state = 'firing'
  ) THEN NULL ELSE received_at END WHERE id = ? AND incident_id IS NOT NULL`).bind(receipt.id));
  return statements;
}
