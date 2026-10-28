import type { AgentAction } from "../incidents/agent-action";
import { createUlid } from "../../shared/ids";

export interface ResponderPost { agentActionJson?:string|null; updateId:string; state:string;
  preset: string; closeAlertOnResolve: boolean; id: string; sourceId: string; externalId: string; sealedCredentials: string;
  reference: string; title: string; lifecycle: string; customerImpact: string;
  affectedAudience: string; whatStillWorks: string; details: string; nextUpdateAt: string | null;
}

/** Publication and note intent commit together. The unique key and atomic claim
 * permit one network request per update and linked responder incident. */
export function createResponderRepository(db: D1Database) {
  return {
    publicationStatements(input: { updateId: string; incidentId: string; queuedAt: string }) {
      return [db.prepare(`INSERT INTO alert_responder_posts (id,source_id,incident_update_id,external_id,state,created_at,updated_at)
        SELECT ? || '/' || s.id || '/' || r.deduplication_key,s.id,?,r.deduplication_key,'queued',?,?
        FROM alert_sources s JOIN alert_receipts r ON r.source_id = s.id
        WHERE (s.responder_preset = 'pagerduty' OR s.vendor_preset IN ('jsm','opsgenie')) AND s.responder_sealed_credentials IS NOT NULL
          AND r.incident_id = ? AND r.deduplication_key IS NOT NULL AND r.state IN ('firing','recovered')
        GROUP BY s.id,r.deduplication_key ON CONFLICT(source_id,incident_update_id,external_id) DO NOTHING`)
        .bind(createUlid(), input.updateId, input.queuedAt, input.queuedAt, input.incidentId)];
    },
    async pending(updateId: string, id?:string) {
      return (await db.prepare(`SELECT COALESCE(s.vendor_preset,s.responder_preset) AS preset,u.agent_action_json AS agentActionJson,p.incident_update_id AS updateId,p.state,s.close_alert_on_resolve AS closeAlertOnResolve,p.id,p.source_id AS sourceId,p.external_id AS externalId,s.responder_sealed_credentials AS sealedCredentials,
        i.reference,i.title,u.lifecycle,u.customer_impact AS customerImpact,u.affected_audience AS affectedAudience,
        u.what_still_works AS whatStillWorks,u.details,u.next_update_at AS nextUpdateAt
        FROM alert_responder_posts p JOIN alert_sources s ON s.id = p.source_id
        JOIN incident_updates u ON u.id = p.incident_update_id JOIN incidents i ON i.id = u.incident_id
        WHERE p.incident_update_id = ? AND (? IS NULL OR p.id=?) AND p.state = 'queued' AND s.responder_sealed_credentials IS NOT NULL`)
        .bind(updateId,id??null,id??null).all<ResponderPost>()).results;
    },
    async post(id:string) {
      return db.prepare(`SELECT p.id,p.incident_update_id AS updateId,p.state,p.source_id AS sourceId,p.external_id AS externalId,
        COALESCE(s.vendor_preset,s.responder_preset) AS preset,s.close_alert_on_resolve AS closeAlertOnResolve,
        u.agent_action_json AS agentActionJson,i.reference,i.title,u.lifecycle,u.customer_impact AS customerImpact,
        u.affected_audience AS affectedAudience,u.what_still_works AS whatStillWorks,u.details,u.next_update_at AS nextUpdateAt
        FROM alert_responder_posts p JOIN alert_sources s ON s.id=p.source_id
        JOIN incident_updates u ON u.id=p.incident_update_id JOIN incidents i ON i.id=u.incident_id WHERE p.id=?`)
        .bind(id).first<Omit<ResponderPost,'sealedCredentials'>>();
    },
    async claim(id: string, at: string) {
      return (await db.prepare("UPDATE alert_responder_posts SET state = 'sending', updated_at = ? WHERE id = ? AND state = 'queued'").bind(at, id).run()).meta.changes === 1;
    },
    async finish(id: string, error: string | null, at: string,action?:AgentAction|null) {
      await db.batch([
        db.prepare("UPDATE alert_responder_posts SET state = ?, error = ?, updated_at = ? WHERE id = ? AND state = 'sending'").bind(error ? "failed" : "sent", error, at, id),
        db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?, 'alert-source', source_id, ?, ?, ?, ?, ? FROM alert_responder_posts WHERE id = ? AND changes() = 1").bind(createUlid(), error ? "responder-note-failed" : "responder-note-sent", action?.sponsor.id??null,JSON.stringify(action?{preparedBy:action}:{}),at, at, id),
      ]);
    },
  };
}
