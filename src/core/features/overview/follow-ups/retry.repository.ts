import { createUlid } from "../../../shared/ids";
import { followUpsQuery } from "./query.repository";

export interface DispatchRetryClaim { id: string; eventId: string; attempts: number; lockedAt: string }
const CLAIM_MS = 5 * 60_000;

export function createFollowUpRetryRepository(db: D1Database) {
  return {
    async claim(id: string, occurrence: string, operatorId: string, now: string): Promise<DispatchRetryClaim | null> {
      const reclaimBefore = new Date(Date.parse(now) - CLAIM_MS).toISOString();
      const auditId = createUlid();
      const [claimed] = await db.batch<DispatchRetryClaim>([
        db.prepare(`${followUpsQuery} UPDATE notification_outbox AS n SET locked_at=?,updated_at=?,failed_at=NULL
          WHERE n.kind='delivery-dispatch' AND n.completed_at IS NULL
            AND (n.locked_at IS NULL OR n.locked_at<?)
            AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')
            AND EXISTS(SELECT 1 FROM follow_ups f WHERE f.id=? AND f.occurrence=? AND f.id='notification-dispatch:' || n.id)
            AND EXISTS(SELECT 1 FROM notification_deliveries d JOIN subscribers s ON s.id=d.subscriber_id
              WHERE d.notification_event_id=n.aggregate_id AND d.outcome='queued' AND s.state='active'
                AND (d.dispatch_locked_at IS NULL OR d.dispatch_locked_at<?)
                AND NOT EXISTS(SELECT 1 FROM notification_delivery_attempts a WHERE a.delivery_id=d.id
                  AND (a.provider_message_id IS NOT NULL OR a.local_capture_id IS NOT NULL)))
          RETURNING id,aggregate_id AS eventId,attempts,locked_at AS lockedAt`)
          .bind(now,now,now,reclaimBefore,operatorId,id,occurrence,reclaimBefore),
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
          SELECT ?,'follow-up',?,'follow-up.retry-requested',?,json_object('occurrence',?),?,? WHERE changes()=1`)
          .bind(auditId,id,operatorId,occurrence,now,now),
      ]);
      return claimed.results[0] ?? null;
    },
    async recordQueueFailure(claim: DispatchRetryClaim, error: string, now: string): Promise<void> {
      // A consumer or the existing direct dispatcher may have completed while
      // Queue submission was in flight. Never resurrect completed work.
      await db.prepare(`UPDATE notification_outbox SET attempts=attempts+1,last_error=?,available_at=?,
        failed_at=NULL,locked_at=NULL,updated_at=? WHERE id=? AND completed_at IS NULL AND locked_at=?`)
        .bind(error,new Date(Date.parse(now)+60_000).toISOString(),now,claim.id,claim.lockedAt).run();
    },
  };
}

export type FollowUpRetryRepository = ReturnType<typeof createFollowUpRetryRepository>;
