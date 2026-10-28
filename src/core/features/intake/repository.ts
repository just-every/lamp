import type { MonitorMapping } from "./uptime";
import { currentStateHistoryStatement } from "../components/state-history-repository";
import { activeRuleRunsGuard } from "./rule-repository";
import { createUlid } from "../../shared/ids";
import { groupedReceiptStatements } from "./grouped-repository";
import type { GroupedReading, LabelMatcher } from "./grouped-alerts";
import { allocateReference, type AllocatedReference } from "../../shared/references/repository";
import type { ComponentState } from "../../shared/domain";
import type { AlertPreset } from "./presets";

export interface AlertSourceRow {
  id: string;
  name: string;
  credentialKind: "hmac-sha256" | "bearer-token";
  signingSecret: string | null;
  responderSealedCredentials?: string | null;
  responderConnected?: boolean;
  closeAlertOnResolve?: boolean;
  bearerTokenHash: string | null;
  timestampHeader: string;
  signatureHeader: string;
  deduplicationPath: string;
  titlePath: string;
  statePath: string;
  recoveredValue: string;
  /** A monitoring tool whose own payload shape this source reads, and the component its drafts attach. */
  preset: AlertPreset | null;
  componentId: string | null;
  labelMatchers?: LabelMatcher[];
  monitorMappings?: MonitorMapping[];
  createdByOperatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertReceiptRow { sourceVersion?: string; id: string; sourceId: string; requestHash: string; deduplicationKey: string | null; incidentId: string | null; state: "firing" | "recovered" | "invalid"; receivedAt: string; recoveredAt: string | null; payloadJson: string; error: string | null; createdAt: string; updatedAt: string; }
export interface AlertReceiptView extends Omit<AlertReceiptRow, "requestHash" | "payloadJson" | "sourceVersion"> { sourceName: string; direction?: "inbound" | "note"; }
export interface AlertReceiptWriteResult { receipt: AlertReceiptRow; incidentCreated: boolean; replayed: boolean; }
/** What has arrived through each source: its last delivery, and each Uptime monitor its own events named. */
export interface AlertSourceActivity { deliveries: Array<{ sourceId: string; lastReceivedAt: string }>; monitors: Array<{ sourceId: string; monitorId: string; monitorName: string; lastSeenAt: string }>; }

export interface IntakeRepository {
  allocateIncidentReference(): Promise<AllocatedReference>;
  listSources(): Promise<AlertSourceRow[]>;
  listActivity(): Promise<AlertSourceActivity>;
  listReceipts(limit: number): Promise<AlertReceiptView[]>;
  deleteSource(sourceId: string, operatorId: string, at: string): Promise<{deleted:boolean;publicChanged:boolean}>;
  operatorEmail(operatorId: string): Promise<string | null>;
  findSource(sourceId: string): Promise<AlertSourceRow | null>;
  upsertSource(source: AlertSourceRow): Promise<void>;
  findReceipt(sourceId: string, requestHash: string): Promise<AlertReceiptRow | null>;
  findOpenIncident(sourceId: string, deduplicationKey: string): Promise<string | null>;
  findLatestLinkedIncident(sourceId: string, deduplicationKey: string): Promise<string | null>;
  recordInvalid(receipt: AlertReceiptRow): Promise<void>;
  recordReceipt(receipt: AlertReceiptRow, incident: { id: string; reference: string; title: string; operatorId: string; timestamp: string; component?: { id: string; state: ComponentState } } | null, group?: GroupedReading, componentIds?: string[], note?: { body: string; operatorId: string }, draftTitle?: string): Promise<AlertReceiptWriteResult>;
  markRecovered(sourceId: string, deduplicationKey: string, recoveredAt: string): Promise<void>;
  /** Closes a draft incident that was never published; a published one is left to its operators. */
  resolveUnpublishedDraft(incidentId: string, resolvedAt: string): Promise<boolean>;
}

function sourceRow(value: Record<string, unknown>): AlertSourceRow {
  return { responderSealedCredentials: value.responderSealedCredentials == null ? null : String(value.responderSealedCredentials), responderConnected: Boolean(value.responderConnected), closeAlertOnResolve: Boolean(value.closeAlertOnResolve), id: String(value.id), name: String(value.name), credentialKind: value.credentialKind as AlertSourceRow["credentialKind"], signingSecret: value.signingSecret === null ? null : String(value.signingSecret), bearerTokenHash: value.bearerTokenHash === null ? null : String(value.bearerTokenHash), timestampHeader: String(value.timestampHeader), signatureHeader: String(value.signatureHeader), deduplicationPath: String(value.deduplicationPath), titlePath: String(value.titlePath), statePath: String(value.statePath), recoveredValue: String(value.recoveredValue), monitorMappings: JSON.parse(String(value.monitorMappingsJson ?? "[]")) as MonitorMapping[], labelMatchers: JSON.parse(String(value.labelMatchersJson ?? "[]")) as LabelMatcher[], preset: value.preset === null || value.preset === undefined ? null : value.preset as AlertPreset, componentId: value.componentId === null || value.componentId === undefined ? null : String(value.componentId), createdByOperatorId: String(value.createdByOperatorId), createdAt: String(value.createdAt), updatedAt: String(value.updatedAt) };
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
  const sourceFields = "id, name, credential_kind AS credentialKind, signing_secret AS signingSecret, responder_sealed_credentials AS responderSealedCredentials, responder_connected AS responderConnected, close_alert_on_resolve AS closeAlertOnResolve, bearer_token_hash AS bearerTokenHash, timestamp_header AS timestampHeader, signature_header AS signatureHeader, deduplication_path AS deduplicationPath, title_path AS titlePath, state_path AS statePath, recovered_value AS recoveredValue, COALESCE(vendor_preset,responder_preset,uptime_preset,grouped_preset,preset) AS preset, label_matchers_json AS labelMatchersJson, monitor_mappings_json AS monitorMappingsJson, component_id AS componentId, created_by_operator_id AS createdByOperatorId, created_at AS createdAt, updated_at AS updatedAt";
  const receiptFields = "alert_receipts.id, alert_receipts.source_id AS sourceId, alert_receipts.request_hash AS requestHash, alert_receipts.deduplication_key AS deduplicationKey, alert_receipts.incident_id AS incidentId, alert_receipts.state, alert_receipts.received_at AS receivedAt, alert_receipts.recovered_at AS recoveredAt, alert_receipts.payload_json AS payloadJson, alert_receipts.error, alert_receipts.created_at AS createdAt, alert_receipts.updated_at AS updatedAt";
  return {
    async allocateIncidentReference() { return allocateReference(binding, "INC"); },
    async listSources() { return (await binding.prepare(`SELECT ${sourceFields} FROM alert_sources ORDER BY name`).all<Record<string, unknown>>()).results.map(sourceRow); },
    async listActivity() {
      const [deliveries, monitors] = await binding.batch<Record<string, unknown>>([
        binding.prepare("SELECT source_id AS sourceId, MAX(received_at) AS lastReceivedAt FROM alert_receipts GROUP BY source_id"),
        // Only authenticated deliveries are recorded, so these names come from the paired Uptime; the latest name wins.
        binding.prepare(`SELECT sourceId, monitorId, monitorName, MAX(receivedAt) AS lastSeenAt FROM (
            SELECT r.source_id AS sourceId, r.received_at AS receivedAt,
              CASE WHEN json_valid(r.payload_json) THEN json_extract(r.payload_json, '$.monitorId') END AS monitorId,
              CASE WHEN json_valid(r.payload_json) THEN json_extract(r.payload_json, '$.monitorName') END AS monitorName
            FROM alert_receipts r INNER JOIN alert_sources s ON s.id = r.source_id WHERE s.uptime_preset = 'uptime')
          WHERE typeof(monitorId) = 'text' AND length(monitorId) BETWEEN 1 AND 200 AND monitorId = trim(monitorId) AND typeof(monitorName) = 'text' AND length(trim(monitorName)) > 0
          GROUP BY sourceId, monitorId ORDER BY monitorName`),
      ]);
      return {
        deliveries: deliveries.results.map(row => ({ sourceId: String(row.sourceId), lastReceivedAt: String(row.lastReceivedAt) })),
        monitors: monitors.results.map(row => ({ sourceId: String(row.sourceId), monitorId: String(row.monitorId), monitorName: String(row.monitorName).trim().slice(0, 200), lastSeenAt: String(row.lastSeenAt) })),
      };
    },
    async listReceipts(limit) {
      const values = await binding.prepare(`SELECT ${receiptFields}, alert_sources.name AS sourceName FROM alert_receipts INNER JOIN alert_sources ON alert_sources.id = alert_receipts.source_id ORDER BY alert_receipts.received_at DESC LIMIT ?`).bind(limit).all<Record<string, unknown>>();
      const outbound = await binding.prepare(`SELECT p.id, p.source_id AS sourceId, s.name AS sourceName, p.external_id AS deduplicationKey, u.incident_id AS incidentId, CASE WHEN p.state = 'sent' THEN 'firing' ELSE 'invalid' END AS state, p.created_at AS receivedAt, p.error FROM alert_responder_posts p JOIN alert_sources s ON s.id = p.source_id JOIN incident_updates u ON u.id = p.incident_update_id WHERE p.state IN ('sent','failed') ORDER BY p.created_at DESC LIMIT ?`).bind(limit).all<Record<string, unknown>>();
      return [...values.results.map(receiptViewRow), ...outbound.results.map(value => ({ ...receiptViewRow({ ...value, recoveredAt: null, createdAt: value.receivedAt, updatedAt: value.receivedAt }), direction: "note" as const }))].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
    },
    async deleteSource(sourceId, operatorId, at) {
      const auditId = createUlid();
      const runs = (await binding.prepare("SELECT run.incident_id AS incidentId,rule.component_id AS componentId FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id WHERE rule.source_id=? AND run.released_at IS NULL").bind(sourceId).all<{incidentId:string;componentId:string}>()).results;
      const result = await binding.batch<{ id: string }>([
        activeRuleRunsGuard(binding,'source',sourceId,runs.map(run=>run.incidentId)),
        binding.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?, 'alert-source', id, 'erased', ?, '{}', ?, ? FROM alert_sources WHERE id = ?").bind(auditId, operatorId, at, at, sourceId),
        binding.prepare("UPDATE alert_rules SET approved_by_operator_id=? WHERE source_id=?").bind(operatorId,sourceId),
        binding.prepare("DELETE FROM alert_sources WHERE id = ? AND EXISTS (SELECT 1 FROM audit_entries WHERE id = ?) RETURNING id").bind(sourceId, auditId),
        ...runs.map(run=>currentStateHistoryStatement(binding,{id:createUlid(),componentId:run.componentId,cause:{type:'incident',id:run.incidentId,operatorId},changedAt:at,createdAt:at,updatedAt:at})),
      ]);
      return { deleted:result[3].results.some(row => row.id === sourceId),publicChanged:runs.length>0 };
    },
    async operatorEmail(operatorId) { return (await binding.prepare("SELECT email FROM operators WHERE id = ?").bind(operatorId).first<{ email: string }>())?.email ?? null; },
    async findSource(sourceId) { const value = await binding.prepare(`SELECT ${sourceFields} FROM alert_sources WHERE id = ?`).bind(sourceId).first<Record<string, unknown>>(); return value ? sourceRow(value) : null; },
    async upsertSource(source) {
      const ids = [...new Set([...(source.labelMatchers ?? []), ...(source.monitorMappings ?? [])].map(row => row.componentId))];
      if (ids.length) {
        const found = await binding.prepare(`SELECT id FROM components WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<{ id: string }>();
        if (found.results.length !== ids.length) throw new Error("A mapped component no longer exists. Choose an existing component.");
      }
      await binding.prepare(`INSERT INTO alert_sources (id,name,credential_kind,signing_secret,bearer_token_hash,timestamp_header,signature_header,deduplication_path,title_path,state_path,recovered_value,preset,component_id,created_by_operator_id,created_at,updated_at,grouped_preset,label_matchers_json,uptime_preset,monitor_mappings_json,responder_preset,responder_sealed_credentials,responder_connected,vendor_preset,close_alert_on_resolve)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, credential_kind=excluded.credential_kind, signing_secret=excluded.signing_secret, bearer_token_hash=excluded.bearer_token_hash, timestamp_header=excluded.timestamp_header, signature_header=excluded.signature_header, deduplication_path=excluded.deduplication_path, title_path=excluded.title_path, state_path=excluded.state_path, recovered_value=excluded.recovered_value, preset=excluded.preset, grouped_preset=excluded.grouped_preset, label_matchers_json=excluded.label_matchers_json, uptime_preset=excluded.uptime_preset, monitor_mappings_json=excluded.monitor_mappings_json, component_id=excluded.component_id, responder_preset=excluded.responder_preset, responder_sealed_credentials=excluded.responder_sealed_credentials, responder_connected=excluded.responder_connected, vendor_preset=excluded.vendor_preset, close_alert_on_resolve=excluded.close_alert_on_resolve, updated_at=excluded.updated_at`)
        .bind(source.id, source.name, source.credentialKind, source.signingSecret, source.bearerTokenHash, source.timestampHeader, source.signatureHeader, source.deduplicationPath, source.titlePath, source.statePath, source.recoveredValue, ["jsm", "opsgenie", "newrelic"].includes(source.preset ?? "") || source.preset === "pagerduty" || source.preset === "uptime" || source.preset === "alertmanager" || source.preset === "grafana" ? null : source.preset, source.componentId, source.createdByOperatorId, source.createdAt, source.updatedAt, source.preset === "alertmanager" || source.preset === "grafana" ? source.preset : null, JSON.stringify(source.labelMatchers ?? []), source.preset === "uptime" ? "uptime" : null, JSON.stringify(source.monitorMappings ?? []), source.preset === "pagerduty" ? source.preset : null, source.responderSealedCredentials ?? null, source.responderConnected ? 1 : 0, ["jsm", "opsgenie", "newrelic"].includes(source.preset ?? "") ? source.preset : null, source.closeAlertOnResolve ? 1 : 0).run();
    },
    async findReceipt(sourceId, requestHash) { const value = await binding.prepare(`SELECT ${receiptFields} FROM alert_receipts WHERE source_id = ? AND request_hash = ?`).bind(sourceId, requestHash).first<Record<string, unknown>>(); return value ? receiptRow(value) : null; },
    async findOpenIncident(sourceId, deduplicationKey) {
      const row = await binding.prepare(`SELECT alert_receipts.incident_id AS incidentId FROM alert_receipts INNER JOIN incidents ON incidents.id = alert_receipts.incident_id WHERE alert_receipts.source_id = ? AND alert_receipts.deduplication_key = ? AND incidents.lifecycle <> 'Resolved' AND incidents.deleted_at IS NULL ORDER BY alert_receipts.received_at DESC LIMIT 1`).bind(sourceId, deduplicationKey).first<{ incidentId: string }>();
      return row?.incidentId ?? null;
    },
    async findLatestLinkedIncident(sourceId, deduplicationKey) {
      const row = await binding.prepare(`SELECT r.incident_id AS incidentId FROM alert_receipts r
        JOIN incidents i ON i.id = r.incident_id WHERE r.source_id = ? AND r.deduplication_key = ?
        AND i.deleted_at IS NULL ORDER BY r.received_at DESC,r.id DESC LIMIT 1`)
        .bind(sourceId, deduplicationKey).first<{ incidentId: string }>();
      return row?.incidentId ?? null;
    },
    async recordInvalid(receipt) { await binding.prepare(`INSERT INTO alert_receipts (id,source_id,request_hash,deduplication_key,incident_id,state,received_at,recovered_at,payload_json,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(receipt.id, receipt.sourceId, receipt.requestHash, receipt.deduplicationKey, receipt.incidentId, receipt.state, receipt.receivedAt, receipt.recoveredAt, receipt.payloadJson, receipt.error, receipt.createdAt, receipt.updatedAt).run(); },
    async recordReceipt(receipt, incident, group, componentIds, note, draftTitle) {
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
        // A preset's draft names the component it watches; nothing about it is published.
        if (incident.component) statements.push(binding.prepare(`INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,created_at,updated_at,published_at)
          SELECT ?, ?, c.id, c.name, ?, 'Primary', ?, ?, NULL FROM components c
          WHERE c.id = ? AND EXISTS (SELECT 1 FROM incident_drafts WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM incident_components WHERE incident_id = ?)`)
          .bind(incident.id, incident.id, incident.component.state, incident.timestamp, incident.timestamp, incident.component.id, incident.id, incident.id));
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

      // A published execution must still receive recovery work after its rule
      // has been edited to draft. Retain that work with the accepted receipt.
      statements.push(binding.prepare(`INSERT OR IGNORE INTO alert_rule_work(receipt_id,source_version)
        SELECT ?,source.updated_at FROM alert_sources source WHERE source.id=? AND EXISTS(
          SELECT 1 FROM alert_rule_runs run JOIN alert_rules rule ON rule.id=run.rule_id
          WHERE rule.source_id=source.id AND run.firing_update_id IS NOT NULL AND run.released_at IS NULL)`)
        .bind(receipt.id,receipt.sourceId));

      for (const componentId of componentIds ?? []) statements.push(binding.prepare(`INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,created_at,updated_at,published_at)
        SELECT ?,r.incident_id,c.id,c.name,'Major outage','Primary',?,?,NULL FROM alert_receipts r JOIN components c ON c.id = ?
        WHERE r.id = ? AND r.incident_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM incident_components ic WHERE ic.incident_id = r.incident_id AND ic.component_id = c.id)`)
        .bind(createUlid(), receipt.receivedAt, receipt.receivedAt, componentId, receipt.id));
      if (draftTitle) {
        // A repeat Create refreshes only an untouched, unpublished alert draft.
        // Never replace operator wording, a reviewed/scheduled draft or a title
        // the operator changed. Rotate the version when its title changes so a
        // previously opened composer must acknowledge the refreshed draft.
        statements.push(binding.prepare(`UPDATE incidents SET title = ?, updated_at = ?
          WHERE id = (SELECT incident_id FROM alert_receipts WHERE id = ?) AND title <> ?
          AND lifecycle <> 'Resolved' AND NOT EXISTS (SELECT 1 FROM incident_updates WHERE incident_id = incidents.id)
          AND EXISTS (SELECT 1 FROM incident_drafts d WHERE d.incident_id = incidents.id AND d.affected_audience = '' AND d.customer_impact = '' AND d.what_still_works = '' AND d.details = '' AND d.next_update_at IS NULL AND d.reviewed_at IS NULL AND d.scheduled_publish_at IS NULL)
          AND EXISTS (SELECT 1 FROM alert_receipts r WHERE r.incident_id = incidents.id AND r.source_id = ? AND r.id <> ? AND json_extract(r.payload_json,'$.action') = 'Create' AND substr(trim(json_extract(r.payload_json,'$.alert.message')),1,250) = incidents.title)`)
          .bind(draftTitle, receipt.receivedAt, receipt.id, draftTitle, receipt.sourceId, receipt.id));
        statements.push(binding.prepare(`UPDATE incident_drafts SET id = ?, updated_at = ? WHERE incident_id = (SELECT incident_id FROM alert_receipts WHERE id = ?) AND changes() = 1`)
          .bind(createUlid(), receipt.receivedAt, receipt.id));
      }
      if (note) statements.push(binding.prepare(`INSERT INTO incident_internal_notes (id,incident_id,body,author_operator_id,created_at,updated_at)
        SELECT ?,incident_id,?,?,?,? FROM alert_receipts WHERE id = ? AND incident_id IS NOT NULL`)
        .bind(createUlid(), note.body, note.operatorId, receipt.receivedAt, receipt.receivedAt, receipt.id));
      if (group) statements.push(...groupedReceiptStatements(binding, receipt, group));
      if (receipt.sourceVersion) statements.push(binding.prepare(`SELECT CASE WHEN
        NOT EXISTS(SELECT 1 FROM alert_rules WHERE source_id=? AND mode<>'draft')
        OR EXISTS(SELECT 1 FROM alert_sources WHERE id=? AND updated_at=?)
        THEN 1 ELSE json('Alert source changed') END`).bind(receipt.sourceId,receipt.sourceId,receipt.sourceVersion));
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
    async resolveUnpublishedDraft(incidentId, resolvedAt) {
      const results = await binding.batch([
        binding.prepare(`UPDATE incidents SET lifecycle = 'Resolved', resolved_at = ?, updated_at = ? WHERE id = ? AND lifecycle <> 'Resolved' AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM incident_updates WHERE incident_id = incidents.id) AND NOT EXISTS (SELECT 1 FROM alert_group_members WHERE incident_id = incidents.id AND state = 'firing')`).bind(resolvedAt, resolvedAt, incidentId),
        binding.prepare(`UPDATE incident_drafts SET lifecycle = 'Resolved', updated_at = ? WHERE incident_id = ? AND changes() = 1`).bind(resolvedAt, incidentId),
      ]);
      return results[0]?.meta.changes === 1;
    },
    async markRecovered(sourceId, deduplicationKey, recoveredAt) { await binding.prepare(`UPDATE alert_receipts SET recovered_at = ?, updated_at = ? WHERE id = (SELECT id FROM alert_receipts WHERE source_id = ? AND deduplication_key = ? AND state = 'firing' ORDER BY received_at DESC LIMIT 1)`).bind(recoveredAt, recoveredAt, sourceId, deduplicationKey).run(); },
  };
}
