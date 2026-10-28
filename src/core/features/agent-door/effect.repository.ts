/** Read only native identities for queued provider actions. Secret destinations
 * stay in their existing driver and never enter approval or agent resources. */
export function createEffectRepository(db: D1Database) {
  return {
    async channel(id: string) {
      return db.prepare(`SELECT p.incident_update_id AS eventId,d.name AS recipient
        FROM delivery_channel_posts p JOIN delivery_channel_destinations d ON d.id=p.destination_id
        WHERE p.id=? AND d.removed_at IS NULL
          AND (d.created_by_operator_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscriber_directory s WHERE s.id=d.id AND s.state='active'))
        UNION ALL
        SELECT x.event_id AS eventId,d.name AS recipient FROM channel_subscriber_events x
        JOIN subscriber_directory s ON s.id=x.subscriber_id AND s.state='active'
        JOIN delivery_channel_destinations d ON d.id=s.id AND d.removed_at IS NULL WHERE x.id=? LIMIT 1`)
        .bind(id, id).first<{ eventId: string; recipient: string }>();
    },
  };
}
