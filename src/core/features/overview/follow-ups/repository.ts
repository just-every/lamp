import { createUlid } from "../../../shared/ids";
import { followUpsQuery } from "./query.repository";
import type { FollowUpRow } from "./types";

export function createFollowUpsRepository(db: D1Database) {
  return {
    async list(now: string): Promise<FollowUpRow[]> {
      return (await db.prepare(`${followUpsQuery} SELECT f.* FROM follow_ups f
        WHERE NOT EXISTS(SELECT 1 FROM follow_up_dismissals d WHERE d.follow_up_id=f.id AND d.occurrence=f.occurrence)
        ORDER BY f.due_at,f.kind,f.id`).bind(now).all<FollowUpRow>()).results;
    },
    async dismiss(id: string, occurrence: string, reason: string, operatorId: string, now: string): Promise<boolean> {
      const auditId = createUlid();
      const [result] = await db.batch([
        db.prepare(`${followUpsQuery} INSERT INTO follow_up_dismissals(follow_up_id,occurrence,operator_id,reason,created_at)
          SELECT id,occurrence,?,?,? FROM follow_ups WHERE id=? AND occurrence=? AND failure_message IS NOT NULL
            AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')
          ON CONFLICT(follow_up_id,occurrence) DO NOTHING RETURNING follow_up_id`)
          .bind(now,operatorId,reason,now,id,occurrence,operatorId),
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,reason,payload_json,created_at,updated_at)
          SELECT ?,'follow-up',?,'follow-up.dismissed',?,?,json_object('occurrence',?),?,? WHERE changes()=1`)
          .bind(auditId,id,operatorId,reason,occurrence,now,now),
      ]);
      return result.results.length === 1;
    },
  };
}

export type FollowUpsRepository = ReturnType<typeof createFollowUpsRepository>;
