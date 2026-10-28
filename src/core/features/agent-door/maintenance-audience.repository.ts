import { eventPreferenceSql } from '../deliveries/subscriber-eligibility';

/** The same consent and selection facts used by native notice admission.
 * Webhook/channel destinations stay secret; summaries use their durable IDs. */
export function createMaintenanceAudienceRepository(db: D1Database) {
  return {
    async publicComponents(componentIds: string[]) {
      return Boolean(await db.prepare('SELECT 1 FROM components WHERE internal=0 AND id IN (SELECT value FROM json_each(?)) LIMIT 1').bind(JSON.stringify(componentIds)).first());
    },
    async publicWindow(id: string) {
      return Boolean(await db.prepare(`SELECT 1 FROM maintenance_components attached LEFT JOIN components c ON c.id=attached.component_id
        WHERE attached.maintenance_id=? AND ((attached.component_id IS NULL AND attached.detached_internal=0) OR c.internal=0) LIMIT 1`).bind(id).first());
    },
    async socialRecipients() {
      return (await db.prepare('SELECT id,network,name FROM social_accounts WHERE removed_at IS NULL ORDER BY network,id').all<{id:string;network:string;name:string}>()).results
        .map(row => `${row.network}:${row.name}:${row.id}`);
    },
    async recipients(componentIds: string[], previousEventIds?: string[]) {
      const slots = componentIds.length ? componentIds.map(() => '?').join(',') : 'NULL';
      const previousSlots = previousEventIds?.length ? previousEventIds.map(() => '?').join(',') : 'NULL';
      const selection = previousEventIds
        ? `(EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.subscriber_id=s.id AND d.notification_event_id IN (${previousSlots}))
          OR EXISTS(SELECT 1 FROM sms_deliveries d WHERE d.subscriber_id=s.id AND d.kind='maintenance-notice' AND d.event_id IN (${previousSlots}))
          OR EXISTS(SELECT 1 FROM channel_subscriber_events d WHERE d.subscriber_id=s.id AND d.kind='maintenance' AND d.event_id IN (${previousSlots})))`
        : `EXISTS(SELECT 1 FROM components c WHERE c.id IN (${slots}) AND c.internal=0)
          AND (s.selection_mode='all' OR EXISTS(SELECT 1 FROM subscriber_components selected JOIN components c ON c.id=selected.component_id
            WHERE selected.subscriber_id=s.id AND selected.component_id IN (${slots}) AND c.internal=0))`;
      const values = previousEventIds ? [...previousEventIds, ...previousEventIds, ...previousEventIds] : [...componentIds, ...componentIds];
      const rows = (await db.prepare(`SELECT DISTINCT s.id,s.channel,CASE WHEN s.channel='email' THEN s.destination ELSE NULL END AS email
        FROM subscriber_directory s WHERE s.state='active' AND s.channel IN ('email','webhook','sms','slack','teams')
          AND ${eventPreferenceSql('maintenance')} AND ${selection} ORDER BY s.channel,s.id`).bind(...values)
        .all<{ id: string; channel: string; email: string | null }>()).results;
      return rows.map(row => ({ id: row.id, channel: row.channel, label: row.email ?? `${row.channel}:${row.id}` }));
    },
  };
}
