import { eventPreferenceSql } from "../deliveries/subscriber-eligibility";

export function createChatEventRepository(db: D1Database) {
  return {
    maintenanceStatements(input: {eventId:string;componentIds:readonly string[];queuedAt:string;recipientScope?:"eligible"|"previous";previousEventIds?:readonly string[]}) {
      const placeholders=input.componentIds.length?input.componentIds.map(()=>"?").join(','):"NULL";
      const previous=input.recipientScope==='previous';
      const previousIds=input.previousEventIds ?? [];
      const eligibility=previous
        ? `EXISTS(SELECT 1 FROM channel_subscriber_events prior WHERE prior.subscriber_id=s.id AND prior.kind='maintenance' AND prior.event_id IN (${previousIds.length?previousIds.map(()=>'?').join(','):'NULL'}))`
        : `(s.selection_mode='all' OR EXISTS(SELECT 1 FROM subscriber_components sc JOIN components c ON c.id=sc.component_id WHERE sc.subscriber_id=s.id AND sc.component_id IN (${placeholders}) AND c.internal=0)) AND EXISTS(SELECT 1 FROM components c WHERE c.id IN (${placeholders}) AND c.internal=0)`;
      return [db.prepare(`INSERT OR IGNORE INTO channel_subscriber_events(id,subscriber_id,event_id,kind,queued_at)
        SELECT ? || '.' || s.id,s.id,?,'maintenance',? FROM subscriber_directory s
        WHERE s.channel IN ('slack','teams') AND s.state='active' AND ${eventPreferenceSql("maintenance")}
          AND ${eligibility}
          AND EXISTS(SELECT 1 FROM maintenance_notices WHERE id=?)`)
        .bind(input.eventId,input.eventId,input.queuedAt,...(previous?previousIds:[...input.componentIds,...input.componentIds]),input.eventId)];
    },
    async pending(limit:number,id?:string) {
      return (await db.prepare(`SELECT x.id,x.subscriber_id AS subscriberId,x.kind,d.kind AS channelKind,
        c.component_name AS componentName,c.previous_state AS previousState,c.new_state AS newState,c.changed_at AS changedAt,c.claimant_kind AS claimantKind,
        COALESCE(n.agent_action_json,c.agent_action_json) AS agentActionJson,m.reference,m.title,n.kind AS noticeKind,n.body AS noticeBody,n.published_at AS publishedAt,p.timezone
        FROM channel_subscriber_events x JOIN subscriber_directory s ON s.id=x.subscriber_id AND s.state='active'
        JOIN delivery_channel_destinations d ON d.id=s.id AND d.removed_at IS NULL
        JOIN page_settings p ON p.id='default'
        LEFT JOIN component_notification_events c ON c.id=x.event_id AND x.kind='component'
        LEFT JOIN maintenance_notices n ON n.id=x.event_id AND x.kind='maintenance'
        LEFT JOIN maintenance m ON m.id=n.maintenance_id
        WHERE (? IS NULL OR x.id=?) AND NOT EXISTS(SELECT 1 FROM integration_deliveries i WHERE i.namespace='lamp-channels' AND i.id=x.id)
        ORDER BY x.queued_at,x.id LIMIT ?`).bind(id??null,id??null,limit).all<{
          agentActionJson:string|null;
          id:string;subscriberId:string;kind:"maintenance"|"component";channelKind:"slack"|"teams";
          componentName:string|null;previousState:string|null;newState:string|null;changedAt:string|null;claimantKind:string|null;
          reference:string|null;title:string|null;noticeKind:string|null;noticeBody:string|null;publishedAt:string|null;timezone:string;
        }>()).results;
    },
    async active(id:string) {
      const row=await db.prepare("SELECT d.created_by_operator_id AS operatorId,s.state FROM delivery_channel_destinations d LEFT JOIN subscriber_directory s ON s.id=d.id WHERE d.id=? AND d.removed_at IS NULL").bind(id).first<{operatorId:string|null;state:string|null}>();
      return Boolean(row && (row.operatorId!==null || row.state==='active'));
    },
  };
}
