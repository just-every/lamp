import { createUlid } from "../../shared/ids";

export interface ResponderPost {
  id: string; sourceId: string; externalId: string; sealedCredentials: string;
  preset: "pagerduty" | "jsm" | "opsgenie"; state: string; closeState: string;
  reference: string; title: string; lifecycle: string; customerImpact: string;
  affectedAudience: string; whatStillWorks: string; details: string; nextUpdateAt: string | null;
}

/** Publication and note intent commit together. The unique key and atomic claim
 * permit one network request per update and linked responder incident. */
export function createResponderRepository(db: D1Database) {
  return {
    publicationStatements(input: { updateId: string; incidentId: string; queuedAt: string }) {
      return [db.prepare(`INSERT INTO alert_responder_posts (id,source_id,incident_update_id,external_id,state,created_at,updated_at,close_state)
        SELECT ? || '/' || s.id || '/' || r.deduplication_key,s.id,?,r.deduplication_key,'queued',?,?,
          CASE WHEN s.close_alert_on_resolve = 1 AND s.operations_preset IS NOT NULL AND (SELECT lifecycle FROM incident_updates WHERE id = ?) = 'Resolved' THEN 'queued' ELSE 'none' END
        FROM alert_sources s JOIN alert_receipts r ON r.source_id = s.id
        WHERE (s.responder_preset = 'pagerduty' OR s.operations_preset IS NOT NULL) AND s.responder_sealed_credentials IS NOT NULL
          AND r.incident_id = ? AND r.deduplication_key IS NOT NULL AND r.state IN ('firing','recovered')
        GROUP BY s.id,r.deduplication_key ON CONFLICT(source_id,incident_update_id,external_id) DO NOTHING`)
        .bind(createUlid(), input.updateId, input.queuedAt, input.queuedAt, input.updateId, input.incidentId)];
    },
    async pending(updateId: string) {
      return (await db.prepare(`SELECT p.id,p.source_id AS sourceId,p.external_id AS externalId,s.responder_sealed_credentials AS sealedCredentials,
        COALESCE(s.operations_preset,s.responder_preset) AS preset,p.state,p.close_state AS closeState,
        i.reference,i.title,u.lifecycle,u.customer_impact AS customerImpact,u.affected_audience AS affectedAudience,
        u.what_still_works AS whatStillWorks,u.details,u.next_update_at AS nextUpdateAt
        FROM alert_responder_posts p JOIN alert_sources s ON s.id = p.source_id
        JOIN incident_updates u ON u.id = p.incident_update_id JOIN incidents i ON i.id = u.incident_id
        WHERE p.incident_update_id = ? AND (p.state = 'queued' OR p.close_state = 'queued') AND s.responder_sealed_credentials IS NOT NULL`)
        .bind(updateId).all<ResponderPost>()).results;
    },
    async claim(id: string, at: string, kind: "note" | "close" = "note") {
      const column = kind === "close" ? "close_state" : "state";
      return (await db.prepare(`UPDATE alert_responder_posts SET ${column} = 'sending', updated_at = ? WHERE id = ? AND ${column} = 'queued'`).bind(at, id).run()).meta.changes === 1;
    },
    async finish(id: string, error: string | null, at: string, kind: "note" | "close" = "note") {
      const stateColumn = kind === "close" ? "close_state" : "state", errorColumn = kind === "close" ? "close_error" : "error";
      await db.batch([
        db.prepare(`UPDATE alert_responder_posts SET ${stateColumn} = ?, ${errorColumn} = ?, updated_at = ? WHERE id = ? AND ${stateColumn} = 'sending'`).bind(error ? "failed" : "sent", error, at, id),
        db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?, 'alert-source', source_id, ?, NULL, '{}', ?, ? FROM alert_responder_posts WHERE id = ? AND changes() = 1").bind(createUlid(), `responder-${kind}-${error ? "failed" : "sent"}`, at, at, id),
      ]);
    },
  };
}
