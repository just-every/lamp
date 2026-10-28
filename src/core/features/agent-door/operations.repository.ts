import { eventPreferenceSql } from '../deliveries/subscriber-eligibility';

/** Read the same current recipient predicates as native maintenance publication.
 * Destinations whose URL is a credential are represented by stable native ids. */
export function createOperationsRepository(db: D1Database) {
  return {
    async maintenanceAudience(input: { componentIds: string[]; previousEventIds?: string[]; social: boolean }) {
      const previous = input.previousEventIds !== undefined;
      const componentSlots = input.componentIds.length ? input.componentIds.map(() => '?').join(',') : 'NULL';
      const previousIds = input.previousEventIds ?? [];
      const previousSlots = previousIds.length ? previousIds.map(() => '?').join(',') : 'NULL';
      const componentMatch = `(s.selection_mode='all' OR EXISTS(SELECT 1 FROM subscriber_components sc JOIN components c ON c.id=sc.component_id WHERE sc.subscriber_id=s.id AND sc.component_id IN (${componentSlots}) AND c.internal=0)) AND EXISTS(SELECT 1 FROM components c WHERE c.id IN (${componentSlots}) AND c.internal=0)`;
      const previousMatch = `((s.channel IN ('email','webhook') AND EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.subscriber_id=s.id AND d.notification_event_id IN (${previousSlots}))) OR (s.channel='sms' AND EXISTS(SELECT 1 FROM sms_deliveries d WHERE d.subscriber_id=s.id AND d.kind='maintenance-notice' AND d.event_id IN (${previousSlots}))) OR (s.channel IN ('slack','teams') AND EXISTS(SELECT 1 FROM channel_subscriber_events d WHERE d.subscriber_id=s.id AND d.kind='maintenance' AND d.event_id IN (${previousSlots}))))`;
      const rows = (await db.prepare(`SELECT s.id,s.channel,CASE WHEN s.channel IN ('email','sms') THEN s.destination ELSE s.channel || ':' || s.id END AS recipient FROM subscriber_directory s WHERE s.state='active' AND ${eventPreferenceSql('maintenance')} AND (${previous ? previousMatch : componentMatch}) ORDER BY s.channel,s.id`)
        .bind(...(previous ? [...previousIds, ...previousIds, ...previousIds] : [...input.componentIds, ...input.componentIds])).all<{ id: string; channel: string; recipient: string }>()).results;
      if (input.social) {
        const accounts = (await db.prepare("SELECT id,network AS channel,network || ':' || name AS recipient FROM social_accounts WHERE removed_at IS NULL ORDER BY id").all<{ id: string; channel: string; recipient: string }>()).results;
        rows.push(...accounts);
      }
      return rows;
    },
  };
}
