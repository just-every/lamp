import { createUlid } from "../../shared/ids";
import type { IncidentDraftInput } from "../../shared/schemas";
import type { AgentDraftPreparation } from "./promise-draft";

export interface PromiseDraftCommitment { incidentId: string; updateId: string; nextUpdateAt: string }

export function createPromiseDraftRepository(db: D1Database) {
  return {
    async owner(incidentId: string) {
      const row = await db.prepare(`SELECT person.id FROM incidents i LEFT JOIN incident_communication_owners assignment ON assignment.incident_id=i.id LEFT JOIN oa_operators person ON person.id=COALESCE(assignment.operator_id,i.created_by_operator_id) AND person.status='active' WHERE i.id=? AND i.deleted_at IS NULL`).bind(incidentId).first<{ id: string | null }>();
      return row?.id ?? null;
    },
    async save(commitment: PromiseDraftCommitment, draft: IncidentDraftInput, preparation: AgentDraftPreparation): Promise<string | null> {
      const id = createUlid();
      const at = preparation.preparedAt;
      const commitmentKey = new Date(commitment.nextUpdateAt).toISOString();
      const insert = db.prepare(`INSERT INTO incident_drafts(id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,author_operator_id,created_at,updated_at,component_changes_json)
        SELECT ?,i.id,?,?,?,?,?,?,COALESCE(?,(SELECT id FROM operators WHERE deactivated_at IS NULL ORDER BY created_at,id LIMIT 1),i.created_by_operator_id),?,?,'[]'
        FROM incidents i JOIN incident_updates u ON u.incident_id=i.id
        WHERE i.id=? AND i.deleted_at IS NULL AND i.lifecycle<>'Resolved' AND u.id=? AND u.next_update_at=? AND u.is_retroactive=0
          AND u.id=(SELECT id FROM incident_updates WHERE incident_id=i.id ORDER BY published_at DESC,id DESC LIMIT 1)
          AND NOT EXISTS(SELECT 1 FROM incident_drafts WHERE incident_id=i.id)
          AND NOT EXISTS(SELECT 1 FROM incident_agent_draft_preparations WHERE incident_id=i.id AND commitment_at=?)
        ON CONFLICT(incident_id) DO NOTHING`)
        .bind(id,draft.lifecycle,draft.affectedAudience,draft.customerImpact,draft.whatStillWorks,draft.details,draft.nextUpdateAt,preparation.forOwnerId,at,at,commitment.incidentId,commitment.updateId,commitment.nextUpdateAt,commitmentKey);
      const metadata = db.prepare(`INSERT INTO incident_agent_draft_preparations(incident_id,commitment_at,update_id,draft_id,preparation_json,prepared_at)
        SELECT incident_id,?,?,id,?,? FROM incident_drafts WHERE id=?`)
        .bind(commitmentKey,commitment.updateId,JSON.stringify(preparation),at,id);
      const [result] = await db.batch([insert, metadata]);
      return result.meta.changes ? id : null;
    },
    async preparedDraft(incidentId: string): Promise<string | null> {
      const row = await db.prepare(`SELECT d.id FROM incident_drafts d JOIN incident_agent_draft_preparations p ON p.draft_id=d.id AND p.active=1 WHERE d.incident_id=?`).bind(incidentId).first<{ id: string }>();
      return row?.id ?? null;
    },
  };
}
