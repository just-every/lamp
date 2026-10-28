import type { AgentAction } from "../incidents/agent-action";
import { createUlid } from "../../shared/ids";
import { eventPreferenceSql } from "./subscriber-eligibility";

/** Called after the matching history insert, and after incident recipient
 * capture, within the same transaction that commits the state transition. */
export function componentNotificationStatements(binding: D1Database, eventId: string, now: string, agentAction?: AgentAction): D1PreparedStatement[] {
  return [
        binding.prepare(`INSERT OR IGNORE INTO component_notification_events
          (id,component_id,component_name,component_created_at,previous_state,new_state,changed_at,claimant_kind,agent_action_json)
          SELECT h.id,c.id,c.name,c.created_at,h.previous_state,h.new_state,h.changed_at,h.cause_type,
            COALESCE(?,
              (SELECT u.agent_action_json FROM incident_updates u WHERE h.cause_type='incident' AND u.incident_id=h.cause_id AND u.published_at=h.changed_at AND u.created_at=h.created_at ORDER BY u.id DESC LIMIT 1),
              (SELECT n.agent_action_json FROM maintenance_notices n WHERE h.cause_type='maintenance' AND n.maintenance_id=h.cause_id AND n.created_at<=h.created_at ORDER BY n.created_at DESC,n.id DESC LIMIT 1))
          FROM component_state_history h JOIN components c ON c.id = h.component_id
          WHERE h.id = ? AND c.internal = 0 AND h.previous_state <> h.new_state AND h.cause_type <> 'correction'
            AND NOT EXISTS (SELECT 1 FROM incident_updates u WHERE u.incident_id = h.cause_id AND u.published_at = h.changed_at AND u.created_at = h.created_at AND u.is_retroactive = 1)`)
          .bind(agentAction ? JSON.stringify(agentAction) : null, eventId),
        binding.prepare(`INSERT INTO component_notification_deliveries
          (id,subscriber_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type,component_event_id)
          SELECT upper(substr(hex(randomblob(16)),1,26)),s.id,s.channel,'queued',?,?,?,?, 'component-change',e.id
          FROM component_notification_events e JOIN subscriber_directory s ON s.state = 'active' AND s.channel IN ('email','webhook')
          WHERE e.id = ? AND ${eventPreferenceSql("components")}
            AND (s.selection_mode = 'all' OR EXISTS (SELECT 1 FROM subscriber_components sc WHERE sc.subscriber_id = s.id AND sc.component_id = e.component_id))
            AND (COALESCE(s.webhook_format,'lamp') = 'statuspage' OR NOT EXISTS (
              SELECT 1 FROM notification_delivery_records carried JOIN incident_updates u ON u.id = carried.incident_update_id
              JOIN component_state_history h ON h.id = e.id
              WHERE carried.subscriber_id = s.id AND u.incident_id = h.cause_id AND h.cause_type = 'incident'
                AND u.published_at = h.changed_at AND u.created_at = h.created_at))
          ON CONFLICT DO NOTHING`)
          .bind(now, now, now, eventId, eventId),
        binding.prepare(`INSERT OR IGNORE INTO channel_subscriber_events(id,subscriber_id,event_id,kind,queued_at)
          SELECT e.id || '.' || s.id,s.id,e.id,'component',e.changed_at FROM component_notification_events e
          JOIN subscriber_directory s ON s.channel IN ('slack','teams') AND s.state='active'
          WHERE e.id = ? AND ${eventPreferenceSql("components")}
            AND (s.selection_mode='all' OR EXISTS(SELECT 1 FROM subscriber_components sc WHERE sc.subscriber_id=s.id AND sc.component_id=e.component_id))
            AND NOT EXISTS(SELECT 1 FROM delivery_channel_posts p JOIN incident_updates u ON u.id=p.incident_update_id JOIN component_state_history h ON h.id=e.id
              WHERE p.destination_id=s.id AND u.incident_id=h.cause_id AND h.cause_type='incident' AND u.published_at=h.changed_at AND u.created_at=h.created_at)`)
          .bind(eventId),
        binding.prepare(`INSERT OR IGNORE INTO notification_outbox
          (id,kind,aggregate_id,payload_json,available_at,attempts,created_at,updated_at,agent_action_json)
          SELECT ?,'delivery-dispatch',?,json_object('eventId',?,'eventType','component-change'),?,0,?,?,(SELECT agent_action_json FROM component_notification_events WHERE id=?)
          WHERE EXISTS (SELECT 1 FROM notification_delivery_records AS notification_deliveries WHERE notification_event_id = ?)`)
          .bind(createUlid(), eventId, eventId, now, now, now, eventId, eventId),
  ];
}
