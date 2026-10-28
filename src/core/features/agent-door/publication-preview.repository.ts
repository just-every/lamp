import { eventPreferenceSql } from '../deliveries/subscriber-eligibility';
import type { IncidentImpact } from '../../shared/incident-impact';

/** Read-only projection of the native publication selectors. Never return endpoint credentials. */
export function createPublicationPreviewRepository(db: D1Database) {
  return {
    async recipients(componentIds: string[], channels: string[], impact: IncidentImpact): Promise<string[]> {
      if (!componentIds.length) return [];
      const slots = componentIds.map(() => '?').join(',');
      const selected = `(s.selection_mode='all' AND EXISTS(SELECT 1 FROM components c WHERE c.id IN (${slots}) AND c.internal=0)) OR (s.selection_mode='selected' AND EXISTS(SELECT 1 FROM subscriber_components sc JOIN components c ON c.id=sc.component_id WHERE sc.subscriber_id=s.id AND c.id IN (${slots}) AND c.internal=0))`;
      const rows = (await db.prepare(`SELECT s.id,s.channel,s.destination FROM subscriber_directory s WHERE s.state='active'
        AND s.channel IN ('email','webhook','sms') AND (${selected}) AND ${eventPreferenceSql('incidents')}
        AND (s.minimum_impact IS NULL OR ? IN ('major','critical')) ORDER BY s.channel,s.id`)
        .bind(...componentIds,...componentIds,impact).all<{id:string;channel:string;destination:string}>()).results;
      const recipients = rows.filter(row => channels.includes(row.channel)).map(row => `${row.channel}: ${row.channel==='webhook' ? row.id : row.destination}`);
      if (channels.includes('chat')) {
        const posts = (await db.prepare(`SELECT d.id,d.kind,d.name FROM delivery_channel_destinations d
          WHERE d.removed_at IS NULL AND (d.created_by_operator_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscriber_directory s WHERE s.id=d.id AND s.state='active'))
          AND NOT EXISTS(SELECT 1 FROM subscriber_directory s WHERE s.id=d.id AND (s.state<>'active' OR NOT ${eventPreferenceSql('incidents')} OR (s.minimum_impact IS NOT NULL AND ? NOT IN ('major','critical'))))
          AND ((COALESCE((SELECT s.selection_mode FROM subscriber_directory s WHERE s.id=d.id),d.selection_mode)='all' AND EXISTS(SELECT 1 FROM components c WHERE c.id IN (${slots}) AND c.internal=0))
          OR (COALESCE((SELECT s.selection_mode FROM subscriber_directory s WHERE s.id=d.id),d.selection_mode)='selected' AND
            (EXISTS(SELECT 1 FROM channel_destination_components sc JOIN components c ON c.id=sc.component_id WHERE sc.destination_id=d.id AND NOT EXISTS(SELECT 1 FROM subscriber_directory s WHERE s.id=d.id) AND c.id IN (${slots}) AND c.internal=0)
            OR EXISTS(SELECT 1 FROM subscriber_components sc JOIN components c ON c.id=sc.component_id WHERE sc.subscriber_id=d.id AND c.id IN (${slots}) AND c.internal=0)))) ORDER BY d.id`)
          .bind(impact,...componentIds,...componentIds,...componentIds).all<{id:string;kind:string;name:string}>()).results;
        recipients.push(...posts.map(row => `${row.kind}: ${row.name} (${row.id})`));
      }
      if (channels.includes('social')) {
        const accounts = (await db.prepare('SELECT id,network,name FROM social_accounts WHERE removed_at IS NULL ORDER BY id').all<{id:string;network:string;name:string}>()).results;
        recipients.push(...accounts.map(row => `${row.network}: ${row.name} (${row.id})`));
      }
      return recipients;
    },
  };
}
