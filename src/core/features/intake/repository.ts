import { allocateReference, type AllocatedReference } from "../../shared/references/repository";

export interface AlertSourceRow {
  id: string;
  name: string;
  credentialKind: "hmac-sha256" | "bearer-token";
  signingSecret: string | null;
  bearerTokenHash: string | null;
  timestampHeader: string;
  signatureHeader: string;
  deduplicationPath: string;
  titlePath: string;
  statePath: string;
  recoveredValue: string;
  createdByOperatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertReceiptRow { id: string; sourceId: string; requestHash: string; deduplicationKey: string | null; incidentId: string | null; state: "firing" | "recovered" | "invalid"; receivedAt: string; recoveredAt: string | null; payloadJson: string; error: string | null; createdAt: string; updatedAt: string; }
export interface AlertReceiptView extends Omit<AlertReceiptRow, "requestHash" | "payloadJson"> { sourceName: string; }
export interface AlertReceiptWriteResult { receipt: AlertReceiptRow; incidentCreated: boolean; replayed: boolean; }

export interface IntakeRepository {
  allocateIncidentReference(): Promise<AllocatedReference>;
  listSources(): Promise<AlertSourceRow[]>;
  listReceipts(limit: number): Promise<AlertReceiptView[]>;
  findSource(sourceId: string): Promise<AlertSourceRow | null>;
  upsertSource(source: AlertSourceRow): Promise<void>;
  findReceipt(sourceId: string, requestHash: string): Promise<AlertReceiptRow | null>;
  findOpenIncident(sourceId: string, deduplicationKey: string): Promise<string | null>;
  recordInvalid(receipt: AlertReceiptRow): Promise<void>;
  recordReceipt(receipt: AlertReceiptRow, incident: { id: string; reference: string; title: string; operatorId: string; timestamp: string } | null): Promise<AlertReceiptWriteResult>;
  markRecovered(sourceId: string, deduplicationKey: string, recoveredAt: string): Promise<void>;
}

function sourceRow(value: Record<string, unknown>): AlertSourceRow {
  return { id: String(value.id), name: String(value.name), credentialKind: value.credentialKind as AlertSourceRow["credentialKind"], signingSecret: value.signingSecret === null ? null : String(value.signingSecret), bearerTokenHash: value.bearerTokenHash === null ? null : String(value.bearerTokenHash), timestampHeader: String(value.timestampHeader), signatureHeader: String(value.signatureHeader), deduplicationPath: String(value.deduplicationPath), titlePath: String(value.titlePath), statePath: String(value.statePath), recoveredValue: String(value.recoveredValue), createdByOperatorId: String(value.createdByOperatorId), createdAt: String(value.createdAt), updatedAt: String(value.updatedAt) };
}
function receiptRow(value: Record<string, unknown>): AlertReceiptRow {
  return { id: String(value.id), sourceId: String(value.sourceId), requestHash: String(value.requestHash), deduplicationKey: value.deduplicationKey === null ? null : String(value.deduplicationKey), incidentId: value.incidentId === null ? null : String(value.incidentId), state: value.state as AlertReceiptRow["state"], receivedAt: String(value.receivedAt), recoveredAt: value.recoveredAt === null ? null : String(value.recoveredAt), payloadJson: String(value.payloadJson), error: value.error === null ? null : String(value.error), createdAt: String(value.createdAt), updatedAt: String(value.updatedAt) };
}
function receiptViewRow(value: Record<string, unknown>): AlertReceiptView {
  const receipt = receiptRow(value);
  const { requestHash: _requestHash, payloadJson: _payloadJson, ...view } = receipt;
  return { ...view, sourceName: String(value.sourceName) };
}

export function createIntakeRepository(binding: D1Database): IntakeRepository {
  const sourceFields = "id, name, credential_kind AS credentialKind, signing_secret AS signingSecret, bearer_token_hash AS bearerTokenHash, timestamp_header AS timestampHeader, signature_header AS signatureHeader, deduplication_path AS deduplicationPath, title_path AS titlePath, state_path AS statePath, recovered_value AS recoveredValue, created_by_operator_id AS createdByOperatorId, created_at AS createdAt, updated_at AS updatedAt";
  const receiptFields = "alert_receipts.id, alert_receipts.source_id AS sourceId, alert_receipts.request_hash AS requestHash, alert_receipts.deduplication_key AS deduplicationKey, alert_receipts.incident_id AS incidentId, alert_receipts.state, alert_receipts.received_at AS receivedAt, alert_receipts.recovered_at AS recoveredAt, alert_receipts.payload_json AS payloadJson, alert_receipts.error, alert_receipts.created_at AS createdAt, alert_receipts.updated_at AS updatedAt";
  return {
    async allocateIncidentReference() { return allocateReference(binding, "INC"); },
    async listSources() { return (await binding.prepare(`SELECT ${sourceFields} FROM alert_sources ORDER BY name`).all<Record<string, unknown>>()).results.map(sourceRow); },
    async listReceipts(limit) {
      const values = await binding.prepare(`SELECT ${receiptFields}, alert_sources.name AS sourceName FROM alert_receipts INNER JOIN alert_sources ON alert_sources.id = alert_receipts.source_id ORDER BY alert_receipts.received_at DESC LIMIT ?`).bind(limit).all<Record<string, unknown>>();
      return values.results.map(receiptViewRow);
    },
    async findSource(sourceId) { const value = await binding.prepare(`SELECT ${sourceFields} FROM alert_sources WHERE id = ?`).bind(sourceId).first<Record<string, unknown>>(); return value ? sourceRow(value) : null; },
    async upsertSource(source) {
      await binding.prepare(`INSERT INTO alert_sources (id,name,credential_kind,signing_secret,bearer_token_hash,timestamp_header,signature_header,deduplication_path,title_path,state_path,recovered_value,created_by_operator_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, credential_kind=excluded.credential_kind, signing_secret=excluded.signing_secret, bearer_token_hash=excluded.bearer_token_hash, timestamp_header=excluded.timestamp_header, signature_header=excluded.signature_header, deduplication_path=excluded.deduplication_path, title_path=excluded.title_path, state_path=excluded.state_path, recovered_value=excluded.recovered_value, updated_at=excluded.updated_at`)
        .bind(source.id, source.name, source.credentialKind, source.signingSecret, source.bearerTokenHash, source.timestampHeader, source.signatureHeader, source.deduplicationPath, source.titlePath, source.statePath, source.recoveredValue, source.createdByOperatorId, source.createdAt, source.updatedAt).run();
    },
    async findReceipt(sourceId, requestHash) { const value = await binding.prepare(`SELECT ${receiptFields} FROM alert_receipts WHERE source_id = ? AND request_hash = ?`).bind(sourceId, requestHash).first<Record<string, unknown>>(); return value ? receiptRow(value) : null; },
    async findOpenIncident(sourceId, deduplicationKey) {
      const row = await binding.prepare(`SELECT alert_receipts.incident_id AS incidentId FROM alert_receipts INNER JOIN incidents ON incidents.id = alert_receipts.incident_id WHERE alert_receipts.source_id = ? AND alert_receipts.deduplication_key = ? AND incidents.lifecycle <> 'Resolved' AND incidents.deleted_at IS NULL ORDER BY alert_receipts.received_at DESC LIMIT 1`).bind(sourceId, deduplicationKey).first<{ incidentId: string }>();
      return row?.incidentId ?? null;
    },
    async recordInvalid(receipt) { await binding.prepare(`INSERT INTO alert_receipts (id,source_id,request_hash,deduplication_key,incident_id,state,received_at,recovered_at,payload_json,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(receipt.id, receipt.sourceId, receipt.requestHash, receipt.deduplicationKey, receipt.incidentId, receipt.state, receipt.receivedAt, receipt.recoveredAt, receipt.payloadJson, receipt.error, receipt.createdAt, receipt.updatedAt).run(); },
    async recordReceipt(receipt, incident) {
      const statements: D1PreparedStatement[] = [];
      if (incident) {
        // Recheck in the write batch so concurrent firings that both passed the service preflight share one open incident.
        statements.push(binding.prepare(`INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,deleted_at,deletion_reason,created_at,updated_at)
          SELECT ?,?,?, 'Investigating', ?,NULL,?,NULL,NULL,?,?
          WHERE NOT EXISTS (
            SELECT 1 FROM alert_receipts
            INNER JOIN incidents ON incidents.id = alert_receipts.incident_id
            WHERE alert_receipts.source_id = ? AND alert_receipts.deduplication_key = ?
              AND incidents.lifecycle <> 'Resolved' AND incidents.deleted_at IS NULL
          )`)
          .bind(incident.id, incident.reference, incident.title, incident.timestamp, incident.operatorId, incident.timestamp, incident.timestamp, receipt.sourceId, receipt.deduplicationKey));
        statements.push(binding.prepare(`INSERT INTO incident_drafts (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,author_operator_id,created_at,updated_at)
          SELECT ?,?, 'Investigating','','','','',NULL,?,?,? WHERE changes() = 1`)
          .bind(incident.id, incident.id, incident.operatorId, incident.timestamp, incident.timestamp));
      }
      statements.push(binding.prepare(`INSERT INTO alert_receipts (id,source_id,request_hash,deduplication_key,incident_id,state,received_at,recovered_at,payload_json,error,created_at,updated_at)
        SELECT ?,?,?,?,COALESCE((
          SELECT alert_receipts.incident_id FROM alert_receipts
          INNER JOIN incidents ON incidents.id = alert_receipts.incident_id
          WHERE alert_receipts.source_id = ? AND alert_receipts.deduplication_key = ?
            AND incidents.lifecycle <> 'Resolved' AND incidents.deleted_at IS NULL
          ORDER BY alert_receipts.received_at DESC LIMIT 1
        ),?),?,?,?,?,?,?,?`)
        .bind(receipt.id, receipt.sourceId, receipt.requestHash, receipt.deduplicationKey, receipt.sourceId, receipt.deduplicationKey, incident?.id ?? receipt.incidentId, receipt.state, receipt.receivedAt, receipt.recoveredAt, receipt.payloadJson, receipt.error, receipt.createdAt, receipt.updatedAt));

      let incidentCreated = false;
      try {
        const results = await binding.batch(statements);
        incidentCreated = Boolean(incident && results[0]?.meta.changes === 1);
      } catch (cause) {
        const existing = await binding.prepare(`SELECT ${receiptFields} FROM alert_receipts WHERE source_id = ? AND request_hash = ?`).bind(receipt.sourceId, receipt.requestHash).first<Record<string, unknown>>();
        if (existing) return { receipt: receiptRow(existing), incidentCreated: false, replayed: true };
        throw cause;
      }

      const stored = await binding.prepare(`SELECT ${receiptFields} FROM alert_receipts WHERE id = ?`).bind(receipt.id).first<Record<string, unknown>>();
      if (!stored) throw new Error("The accepted alert receipt was not stored.");
      return {
        receipt: receiptRow(stored),
        incidentCreated,
        replayed: false,
      };
    },
    async markRecovered(sourceId, deduplicationKey, recoveredAt) { await binding.prepare(`UPDATE alert_receipts SET recovered_at = ?, updated_at = ? WHERE id = (SELECT id FROM alert_receipts WHERE source_id = ? AND deduplication_key = ? AND state = 'firing' ORDER BY received_at DESC LIMIT 1)`).bind(recoveredAt, recoveredAt, sourceId, deduplicationKey).run(); },
  };
}
