/** Durable rule work contains receipt references and timing, never credentials.
 * The admission trigger creates it in the receipt transaction. */
export function createRuleWorkRepository(db: D1Database) {
  return {
    get: (receiptId: string) => db.prepare("SELECT source_version AS sourceVersion,completed_at AS completedAt FROM alert_rule_work WHERE receipt_id=?").bind(receiptId).first<{sourceVersion:string;completedAt:string|null}>(),
    async pending(now: number) {
      return (await db.prepare(`SELECT r.id AS receiptId,r.source_id AS sourceId,r.incident_id AS incidentId,r.payload_json AS payloadJson,r.received_at AS receivedAt
        FROM alert_rule_work work JOIN alert_receipts r ON r.id=work.receipt_id
        WHERE work.completed_at IS NULL AND work.attempts<5 AND work.next_attempt_at<=?
        ORDER BY r.rowid LIMIT 10`).bind(now).all<{receiptId:string;sourceId:string;incidentId:string|null;payloadJson:string;receivedAt:string}>()).results;
    },
    async complete(receiptId: string, at: string, reason?: string) {
      await db.batch([
        db.prepare("UPDATE alert_rule_work SET completed_at=?,last_error=? WHERE receipt_id=?").bind(at,reason ?? null,receiptId),
        ...(reason ? [db.prepare("UPDATE alert_receipts SET error=? WHERE id=?").bind(reason,receiptId)] : [
          db.prepare("UPDATE alert_receipts SET error=NULL WHERE id=? AND error LIKE 'Automatic rule action %'").bind(receiptId),
        ]),
      ]);
    },
    async failed(receiptId: string, now: number) {
      const retry = "Automatic rule action could not finish. It will retry through Cron; after five failed attempts, review this alert and rule.";
      const failed = "Automatic rule action failed after five attempts. Review this alert and rule before publishing manually.";
      await db.batch([
        db.prepare("UPDATE alert_rule_work SET attempts=attempts+1,next_attempt_at=?,last_error=CASE WHEN attempts+1>=5 THEN ? ELSE ? END WHERE receipt_id=? AND completed_at IS NULL").bind(now+60_000,failed,retry,receiptId),
        db.prepare("UPDATE alert_receipts SET error=(SELECT last_error FROM alert_rule_work WHERE receipt_id=?) WHERE id=? AND EXISTS(SELECT 1 FROM alert_rule_work WHERE receipt_id=? AND completed_at IS NULL)").bind(receiptId,receiptId,receiptId),
      ]);
    },
  };
}
