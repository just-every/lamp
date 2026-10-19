import type { RecoveryEvidence } from "../brief/recovery-check";

export interface RecoverySnapshot {
  evidence: RecoveryEvidence;
  snapshot: string;
}

// One canonical serialization is used both for reading and for the write-batch
// fence. It covers new/deleted receipts, recovery mutations, source identity,
// and every authoritative group member, including partial recoveries.
const snapshotSql = `json_object(
  'receipts', json((SELECT json_group_array(json_object(
    'id',id,'sourceId',source_id,'source',source_name,'groupedPreset',grouped_preset,
    'deduplicationKey',deduplication_key,'state',state,'receivedAt',received_at,
    'recoveredAt',recovered_at,'updatedAt',updated_at,'incidentId',incident_id,
    'requestHash',request_hash,'payloadJson',payload_json,'error',error,'createdAt',created_at)) FROM (
      SELECT r.*,s.name AS source_name,s.grouped_preset FROM alert_receipts r
      JOIN alert_sources s ON s.id = r.source_id WHERE r.incident_id = ? ORDER BY r.received_at,r.id
    ))),
  'members', json((SELECT json_group_array(json_object(
    'sourceId',source_id,'source',source_name,'groupKey',group_key,'fingerprint',fingerprint,
    'state',state,'receivedAt',received_at,'recoveredAt',recovered_at,'incidentId',incident_id)) FROM (
      SELECT m.*,s.name AS source_name FROM alert_group_members m
      JOIN alert_sources s ON s.id = m.source_id WHERE m.incident_id = ? ORDER BY m.source_id,m.group_key,m.fingerprint
    )))
)`;

export async function loadRecoverySnapshot(db: D1Database, incidentId: string): Promise<RecoverySnapshot | null> {
  const row = await db.prepare(`SELECT ${snapshotSql} AS snapshot FROM incidents WHERE id = ? AND deleted_at IS NULL`)
    .bind(incidentId, incidentId, incidentId).first<{ snapshot: string }>();
  return row ? { evidence: JSON.parse(row.snapshot) as RecoveryEvidence, snapshot: row.snapshot } : null;
}

export function recoverySnapshotGuard(db: D1Database, incidentId: string, snapshot: string): D1PreparedStatement {
  return db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM incidents WHERE id = ? AND deleted_at IS NULL)
    AND ${snapshotSql} = ? THEN 1 ELSE json('Recovery evidence changed') END`)
    .bind(incidentId, incidentId, incidentId, snapshot);
}
