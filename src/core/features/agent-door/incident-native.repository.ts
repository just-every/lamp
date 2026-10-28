import { readIncidentAgentAttributions } from './incident-attribution.repository';
import { eventPreferenceSql } from '../deliveries/subscriber-eligibility';
import { mostSevereState } from '../../shared/domain';
import type { IncidentView } from '../incidents/service';
/** Read-only native audience projection; it never captures recipients or starts dispatch. */
export function createIncidentDoorRepository(db: D1Database) {
    return {
        async publicationAudience(incident: IncidentView, channels: string[], report = false): Promise<Array<{
            id: string;
            label: string;
        }>> {
            if (!channels.length || (!report && incident.updates.some(update => update.isRetroactive)))
                return [];
            const ids = [...new Set([...incident.components.flatMap(component => component.componentId ? [component.componentId] : []), ...(!report ? incident.draft?.componentChanges.map(change => change.componentId) ?? [] : [])])];
            const peak = mostSevereState([incident.impact ?? 'Operational', ...incident.components.map(component => (!report ? incident.draft?.componentChanges.find(change => change.componentId === component.componentId)?.state : undefined) ?? component.state), ...(!report ? incident.draft?.componentChanges.map(change => change.state) ?? [] : [])]);
            const meets = incident.impactOverride === 'major' || incident.impactOverride === 'critical' || (incident.impactOverride === null && (peak === 'Major outage' || peak === 'Partially unavailable'));
            const slots = ids.map(() => '?').join(',') || 'NULL';
            const selected = `(s.selection_mode='all' AND EXISTS(SELECT 1 FROM components c WHERE c.id IN (${slots}) AND c.internal=0)) OR (s.selection_mode='selected' AND EXISTS(SELECT 1 FROM subscriber_components sc JOIN components c ON c.id=sc.component_id WHERE sc.subscriber_id=s.id AND sc.component_id IN (${slots}) AND c.internal=0))`;
            const base = [...new Set(channels.filter(channel => ['email', 'webhook', 'sms'].includes(channel)))];
            const subscribers = base.length ? (await db.prepare(`SELECT s.id,s.channel,s.destination FROM subscriber_directory s WHERE s.state='active' AND s.channel IN (${base.map(() => '?').join(',')}) AND (${selected}) AND ${eventPreferenceSql('incidents')} AND (s.minimum_impact IS NULL OR ?=1) ORDER BY s.channel,s.id`).bind(...base, ...ids, ...ids, Number(meets)).all<{
                id: string;
                channel: string;
                destination: string;
            }>()).results : [];
            const audience = subscribers.map(s => ({ id: s.id, label: s.channel === 'webhook' ? `Webhook subscription ${s.id}` : `${s.channel}: ${s.destination}` }));
            if (channels.includes('chat')) {
                const rows = (await db.prepare(`SELECT d.id,d.kind,d.name FROM delivery_channel_destinations d WHERE d.removed_at IS NULL
          AND (d.created_by_operator_id IS NOT NULL OR EXISTS(SELECT 1 FROM subscriber_directory own WHERE own.id=d.id AND own.state='active'))
          AND NOT EXISTS(SELECT 1 FROM subscriber_directory cs WHERE cs.id=d.id AND (cs.state<>'active' OR NOT ${eventPreferenceSql('incidents', 'cs')} OR (cs.minimum_impact IS NOT NULL AND ?=0)))
          AND ((COALESCE((SELECT cs.selection_mode FROM subscriber_directory cs WHERE cs.id=d.id),d.selection_mode)='all' AND EXISTS(SELECT 1 FROM components c WHERE c.id IN (${slots}) AND c.internal=0))
          OR (COALESCE((SELECT cs.selection_mode FROM subscriber_directory cs WHERE cs.id=d.id),d.selection_mode)='selected' AND (EXISTS(SELECT 1 FROM channel_destination_components sc JOIN components c ON c.id=sc.component_id WHERE sc.destination_id=d.id AND NOT EXISTS(SELECT 1 FROM subscriber_directory cs WHERE cs.id=d.id) AND sc.component_id IN (${slots}) AND c.internal=0) OR EXISTS(SELECT 1 FROM subscriber_components sc JOIN components c ON c.id=sc.component_id WHERE sc.subscriber_id=d.id AND sc.component_id IN (${slots}) AND c.internal=0)))) ORDER BY d.id`).bind(Number(meets), ...ids, ...ids, ...ids).all<{
                    id: string;
                    kind: string;
                    name: string;
                }>()).results;
                audience.push(...rows.map(row => ({ id: row.id, label: `${row.kind}: ${row.name}` })));
            }
            if (channels.includes('social')) {
                const rows = (await db.prepare('SELECT id,network,name FROM social_accounts WHERE removed_at IS NULL ORDER BY id').all<{
                    id: string;
                    network: string;
                    name: string;
                }>()).results;
                audience.push(...rows.map(row => ({ id: row.id, label: `${row.network}: ${row.name}` })));
            }
            return audience;
        },
        async report(id: string) { const report=await db.prepare(`SELECT r.id,r.incident_id AS incidentId,r.summary,r.timeline,r.cause,r.remediation,r.published_at AS publishedAt,r.author_operator_id AS authorOperatorId,r.created_at AS createdAt,r.updated_at AS updatedAt FROM incident_reports r JOIN incidents i ON i.id=r.incident_id WHERE r.id=? AND i.deleted_at IS NULL`).bind(id).first(); if(!report)return null; const attribution=await readIncidentAgentAttributions(db,[id]); return {...report,agentAttribution:attribution.get(`incident-report:${id}`)??null}; },
    };
}
