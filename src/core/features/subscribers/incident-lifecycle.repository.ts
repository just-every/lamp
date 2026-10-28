/** Terminal facts share the publisher/receipt transaction, so no later event can
 * slip between the end of a follow and its subscriber state transition. */
export function finishIncidentSubscriptionStatements(db: D1Database, now: string): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE subscribers SET state='deactivated',deactivation_reason='incident-follow-ended',deactivated_at=?,updated_at=?
      WHERE state IN ('pending','active') AND id IN (SELECT subscriber_id FROM incident_subscriptions WHERE ended_at IS NOT NULL)`).bind(now,now),
    db.prepare(`UPDATE subscriber_tokens SET revoked_at=?,updated_at=? WHERE revoked_at IS NULL
      AND subscriber_id IN (SELECT subscriber_id FROM incident_subscriptions WHERE ended_at IS NOT NULL)`).bind(now,now),
    db.prepare(`UPDATE notification_deliveries SET outcome='suppressed',outcome_at=?,updated_at=? WHERE outcome='queued'
      AND subscriber_id IN (SELECT subscriber_id FROM incident_subscriptions x WHERE x.ended_at IS NOT NULL
        AND (x.final_event_id IS NULL OR x.final_event_id<>notification_deliveries.notification_event_id))`).bind(now,now),
    db.prepare(`UPDATE sms_deliveries SET outcome='suppressed',outcome_at=? WHERE outcome='queued'
      AND subscriber_id IN (SELECT subscriber_id FROM incident_subscriptions x WHERE x.ended_at IS NOT NULL
        AND (x.final_event_id IS NULL OR x.final_event_id<>sms_deliveries.event_id))`).bind(now),
  ];
}

export function incidentResolutionReceiptStatements(db: D1Database, deliveryId: string, now: string, sms=false): D1PreparedStatement[] {
  const deliveries=sms?'sms_deliveries':'notification_deliveries';
  return [
    db.prepare(`UPDATE incident_subscriptions SET resolution_delivered_at=COALESCE(resolution_delivered_at,?),
        resolution_at=COALESCE(resolution_at,(SELECT u.published_at FROM ${deliveries} d JOIN incident_updates u ON u.id=d.incident_update_id WHERE d.id=?)),
        ended_at=CASE WHEN include_report=0 THEN COALESCE(ended_at,?) ELSE ended_at END
      WHERE subscriber_id IN (SELECT d.subscriber_id FROM ${deliveries} d JOIN incident_updates u ON u.id=d.incident_update_id
        WHERE d.id=? AND d.outcome='delivered' AND u.lifecycle='Resolved' AND u.incident_id=incident_subscriptions.incident_id)
        AND ended_at IS NULL`).bind(now,deliveryId,now,deliveryId),
    ...finishIncidentSubscriptionStatements(db,now),
  ];
}

/** Capture the report first. Its already-captured final event remains deliverable
 * after the follow ends, but no subsequent event can acquire this recipient. */
export function incidentReportEndStatements(db: D1Database, incidentId: string, reportId: string, now: string): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE incident_subscriptions SET ended_at=?,final_event_id=? WHERE incident_id=? AND include_report=1 AND ended_at IS NULL
      AND EXISTS(SELECT 1 FROM subscribers s WHERE s.id=incident_subscriptions.subscriber_id AND s.state='active')
      AND EXISTS(SELECT 1 FROM incident_reports r WHERE r.id=? AND r.incident_id=? AND r.published_at=?)`).bind(now,reportId,incidentId,reportId,incidentId,now),
    ...finishIncidentSubscriptionStatements(db,now),
  ];
}

export function createIncidentSubscriptionLifecycleRepository(db: D1Database) {
  return {
    async expire(now: string) {
      const cutoff=new Date(Date.parse(now)-30*24*60*60*1000).toISOString();
      await db.batch([
        db.prepare(`UPDATE incident_subscriptions SET ended_at=strftime('%Y-%m-%dT%H:%M:%fZ',resolution_at,'+30 days') WHERE ended_at IS NULL AND include_report=1
          AND resolution_at IS NOT NULL AND resolution_at<=?`).bind(cutoff),
        ...finishIncidentSubscriptionStatements(db,now),
      ]);
    },
    async expiredAddressIds(now: string) {
      const cutoff=new Date(Date.parse(now)-24*60*60*1000).toISOString();
      return (await db.prepare(`SELECT x.subscriber_id AS id FROM incident_subscriptions x JOIN subscribers s ON s.id=x.subscriber_id
        WHERE x.ended_at IS NOT NULL AND x.ended_at<=? AND s.destination NOT LIKE 'deleted:%' ORDER BY x.ended_at,x.subscriber_id LIMIT 100`).bind(cutoff).all<{id:string}>()).results.map(row=>row.id);
    },
  };
}
