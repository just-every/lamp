/** Native delivery facts for retry classification. Protocol state is not read
 * or changed here, and webhook capability paths never enter a summary. */
export function agentQueueRepository(db: D1Database) {
  return {
    async recipients(followUpId: string) {
      if (!followUpId.startsWith('notification-dispatch:')) return [];
      const id = followUpId.slice('notification-dispatch:'.length);
      const { results } = await db.prepare(`SELECT d.id,s.channel,s.destination
        FROM notification_outbox o JOIN notification_delivery_records d ON d.notification_event_id=o.aggregate_id
        JOIN subscriber_directory s ON s.id=d.subscriber_id
        WHERE o.id=? AND o.completed_at IS NULL AND d.outcome='queued' AND s.state='active'
          AND NOT EXISTS(SELECT 1 FROM notification_attempt_records a WHERE a.delivery_id=d.id
            AND (a.provider_message_id IS NOT NULL OR a.local_capture_id IS NOT NULL))
        ORDER BY d.id`).bind(id).all<{ id: string; channel: string; destination: string }>();
      return results.map(row => {
        if (row.channel !== 'webhook') return row.destination;
        try { return new URL(row.destination).origin; }
        catch { return '[webhook destination]'; }
      });
    },
  };
}
