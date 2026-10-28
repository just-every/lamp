import { createUlid } from "../../shared/ids";
import { eventPreferenceSql, incidentThresholdSql } from "../deliveries/subscriber-eligibility";
import type { SubscriberPreferences } from "../subscribers/preferences";
export interface SmsDelivery { agentActionJson?:string|null; id:string;subscriberId:string;destination:string;eventId:string;kind:"incident-update"|"maintenance-notice"|"incident-report";incidentUpdateId:string|null;outcome:string;providerMessageId:string|null;queuedAt:string;outcomeAt:string|null;subscriberState:string;reference:string|null;title:string|null;wording:string|null;body:string|null;maintenanceReference:string|null;reportSummary:string|null;reportTimeline:string|null;reportCause:string|null;reportRemediation:string|null }
export function createSmsRepository(db:D1Database) {
  return {
    async operatorAllowed(id:string,ownerOnly=false) {
      return Boolean(await db.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin') AND (?=0 OR role='owner')").bind(id,Number(ownerOnly)).first());
    },
    async settings() {
      const row=await db.prepare("SELECT countries_json AS countriesJson,support_contact AS supportContact FROM sms_settings WHERE id=1").first<{countriesJson:string;supportContact:string}>();
      if(!row)throw new Error("SMS settings are unavailable.");
      return {countries:JSON.parse(row.countriesJson) as string[],supportContact:row.supportContact};
    },
    async updateSettings(countries:string[],supportContact:string,operatorId:string,now:string) {
      await db.batch([
        db.prepare("UPDATE sms_settings SET countries_json=?,support_contact=? WHERE id=1").bind(JSON.stringify(countries),supportContact),
        db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'settings','sms','sms-settings-updated',?,?,?,?)").bind(createUlid(),operatorId,JSON.stringify({countries}),now,now),
      ]);
    },
    async subscribe(input:{id:string;phone:string;componentIds:string[];preferences:SubscriberPreferences;now:string;operatorId?:string}) {
      const nonce=createUlid();
      await db.batch([
        db.prepare(`SELECT CASE WHEN (? IS NULL OR EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')))
          AND (SELECT COUNT(*) FROM components WHERE internal=0 AND id IN (SELECT value FROM json_each(?)))=json_array_length(?)
          THEN 1 ELSE json('SMS subscriber authority or components changed.') END`).bind(input.operatorId??null,input.operatorId??null,JSON.stringify(input.componentIds),JSON.stringify(input.componentIds)),
        db.prepare(`INSERT INTO subscribers(id,channel,sms_kind,destination,state,selection_mode,token_hash,event_kinds_json,minimum_impact,preferences_set,created_at,updated_at,created_by_operator_id)
          VALUES(?,'webhook',1,?,'pending',?,?,?,?,1,?,?,?) ON CONFLICT(destination) DO UPDATE SET state='pending',selection_mode=excluded.selection_mode,
          deactivation_reason=NULL,deactivated_at=NULL,token_hash=excluded.token_hash,event_kinds_json=excluded.event_kinds_json,minimum_impact=excluded.minimum_impact,
          preferences_set=1,created_at=excluded.created_at,updated_at=excluded.updated_at WHERE subscribers.state='deactivated' AND subscribers.sms_kind=1`)
          .bind(input.id,input.phone,input.componentIds.length?'selected':'all',nonce,JSON.stringify(input.preferences.eventKinds),input.preferences.minimumImpact,input.now,input.now,input.operatorId??null),
        db.prepare("INSERT OR IGNORE INTO sms_subscriptions(subscriber_id) SELECT id FROM subscribers WHERE id=? AND token_hash=?").bind(input.id,nonce),
        ...(input.operatorId ? [
          db.prepare(`INSERT OR IGNORE INTO subscriber_intake(subscriber_id,source,operator_id,created_at)
            SELECT id,'operator',?,? FROM subscribers WHERE id=? AND token_hash=?`).bind(input.operatorId,input.now,input.id,nonce),
          db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
            SELECT ?,'subscriber',id,'subscriber.added',?,json_object('channel','sms'),?,? FROM subscribers WHERE id=? AND token_hash=?`)
            .bind(createUlid(),input.operatorId,input.now,input.now,input.id,nonce),
        ] : []),
        db.prepare("DELETE FROM subscriber_components WHERE subscriber_id=? AND EXISTS(SELECT 1 FROM subscribers WHERE id=? AND token_hash=?)").bind(input.id,input.id,nonce),
        ...input.componentIds.map(id=>db.prepare(`INSERT OR IGNORE INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at)
          SELECT ?,?,id,?,? FROM components WHERE id=? AND internal=0 AND EXISTS(SELECT 1 FROM subscribers WHERE id=? AND token_hash=?)`).bind(createUlid(),input.id,input.now,input.now,id,input.id,nonce)),
      ]);
    },
    async pending(id:string) {
      return db.prepare(`SELECT s.id,s.destination,s.created_at AS createdAt,x.opt_in_wording AS wording,x.page_name AS pageName
        FROM subscriber_directory s JOIN sms_subscriptions x ON x.subscriber_id=s.id WHERE s.id=? AND s.channel='sms' AND s.state='pending'`).bind(id).first<{id:string;destination:string;createdAt:string;wording:string;pageName:string}>();
    },
    async rememberOptIn(id:string,pageName:string,wording:string,now:string) {
      await db.prepare("UPDATE sms_subscriptions SET page_name=?,opt_in_wording=?,pending_since=? WHERE subscriber_id=?").bind(pageName,wording,now,id).run();
    },
    async inbound(messageSid:string,number:string,now:string) {
      const row=await db.prepare(`INSERT OR IGNORE INTO sms_inbound_events(message_sid,subscriber_id,received_at)
        SELECT ?,id,? FROM subscriber_directory WHERE destination=? AND channel='sms' RETURNING subscriber_id AS subscriberId`).bind(messageSid,now,number).first<{subscriberId:string}>();
      return row?.subscriberId??null;
    },
    async activate(id:string,now:string) {
      const consent=createUlid();
      const result=await db.batch([
        db.prepare(`INSERT INTO sms_consents(id,subscriber_id,number,page_name,wording,consented_at)
          SELECT ?,s.id,s.destination,x.page_name,x.opt_in_wording,? FROM subscribers s JOIN sms_subscriptions x ON x.subscriber_id=s.id
          WHERE s.id=? AND s.state='pending' AND x.pending_since<>'' AND x.opt_in_wording<>'' AND x.pending_since>?
            AND s.created_at>?`).bind(consent,now,id,new Date(Date.parse(now)-72*60*60*1000).toISOString(),new Date(Date.parse(now)-72*60*60*1000).toISOString()),
        db.prepare("UPDATE subscribers SET state='active',updated_at=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM sms_consents WHERE id=?) RETURNING id").bind(now,id,consent),
        db.prepare("UPDATE subscriber_intake SET confirmed_at=? WHERE subscriber_id=? AND EXISTS(SELECT 1 FROM sms_consents WHERE id=?)").bind(now,id,consent),
      ]);
      return result[1].results.length>0;
    },
    async stop(id:string,now:string) {
      const result=await db.batch([
        db.prepare("UPDATE subscribers SET state='deactivated',deactivation_reason='SMS STOP',deactivated_at=?,updated_at=? WHERE id=? AND state<>'deactivated' RETURNING id").bind(now,now,id),
        db.prepare("UPDATE subscriber_tokens SET revoked_at=?,updated_at=? WHERE subscriber_id=? AND revoked_at IS NULL").bind(now,now,id),
        db.prepare("UPDATE sms_deliveries SET outcome='suppressed',outcome_at=? WHERE subscriber_id=? AND outcome='queued'").bind(now,id),
      ]);
      return result[0].results.length>0;
    },
    publicationStatements(input:{eventId:string;kind:SmsDelivery['kind'];incidentUpdateId?:string;maintenanceId?:string;incidentReportId?:string;componentIds:readonly string[];queuedAt:string;recipientScope?:'eligible'|'previous';previousEventIds?:readonly string[]}) {
      const slots=input.componentIds.length?input.componentIds.map(()=>'?').join(','):'NULL';
      const previous=input.recipientScope==='previous';
      const previousIds=input.previousEventIds??[];
      const eligible=previous?`EXISTS(SELECT 1 FROM sms_deliveries d WHERE d.subscriber_id=s.id AND d.kind='maintenance-notice' AND d.event_id IN (${previousIds.length?previousIds.map(()=>'?').join(','):'NULL'}))`:
        `(s.selection_mode='all' OR EXISTS(SELECT 1 FROM subscriber_components sc WHERE sc.subscriber_id=s.id AND sc.component_id IN (${slots}))) AND EXISTS(SELECT 1 FROM components c WHERE c.id IN (${slots}) AND c.internal=0)`;
      const threshold=input.kind==='maintenance-notice'?'1':incidentThresholdSql(input.incidentUpdateId?'(SELECT incident_id FROM incident_updates WHERE id=?)':'(SELECT incident_id FROM incident_reports WHERE id=?)');
      return [db.prepare(`INSERT OR IGNORE INTO sms_deliveries(id,subscriber_id,event_id,kind,incident_update_id,maintenance_id,incident_report_id,outcome,queued_at,outcome_at)
        SELECT ?||'.'||s.id,s.id,?,?,?,?,?,CASE WHEN s.state='active' THEN 'queued' ELSE 'suppressed' END,?,CASE WHEN s.state='active' THEN NULL ELSE ? END
        FROM subscriber_directory s WHERE s.channel='sms' AND s.state IN ('active','deactivated') AND ${eligible}
          AND ${eventPreferenceSql(input.kind==='maintenance-notice'?'maintenance':'incidents')} AND ${threshold}
          ${input.kind==='maintenance-notice'?'AND EXISTS(SELECT 1 FROM maintenance_notices WHERE id=?)':''}`)
        .bind(input.eventId,input.eventId,input.kind,input.incidentUpdateId??null,input.maintenanceId??null,input.incidentReportId??null,input.queuedAt,input.queuedAt,
          ...(previous?previousIds:[...input.componentIds,...input.componentIds]),...(input.kind==='maintenance-notice'?[input.eventId]:[input.incidentUpdateId??input.incidentReportId??null]))];
    },
    async deliveries(updateId?:string,limit=100,pending=false,id?:string) {
      return (await db.prepare(`SELECT d.id,d.subscriber_id AS subscriberId,s.destination,d.event_id AS eventId,d.kind,d.incident_update_id AS incidentUpdateId,
        d.outcome,d.provider_message_id AS providerMessageId,d.queued_at AS queuedAt,d.outcome_at AS outcomeAt,s.state AS subscriberState,
        COALESCE(u.agent_action_json,r.agent_action_json,n.agent_action_json) AS agentActionJson,i.reference,i.title,CASE WHEN u.id IS NULL THEN NULL ELSE u.lifecycle||': '||u.affected_audience||' '||u.customer_impact||' '||COALESCE(u.what_still_works,'')||' '||COALESCE(u.details,'') END AS wording,
        n.body,m.reference AS maintenanceReference,r.summary AS reportSummary,r.timeline AS reportTimeline,r.cause AS reportCause,r.remediation AS reportRemediation
        FROM sms_deliveries d JOIN subscriber_directory s ON s.id=d.subscriber_id
        LEFT JOIN incident_updates u ON u.id=d.incident_update_id LEFT JOIN incidents i ON i.id=COALESCE(u.incident_id,(SELECT incident_id FROM incident_reports WHERE id=d.incident_report_id))
        LEFT JOIN maintenance_notices n ON n.id=d.event_id AND d.kind='maintenance-notice' LEFT JOIN maintenance m ON m.id=d.maintenance_id
        LEFT JOIN incident_reports r ON r.id=d.incident_report_id
        WHERE (? IS NULL OR d.id=?) AND (? IS NULL OR d.incident_update_id=?) AND (?=0 OR d.outcome='queued') ORDER BY d.queued_at,d.id LIMIT ?`).bind(id??null,id??null,updateId??null,updateId??null,Number(pending),limit).all<SmsDelivery>()).results;
    },
    async pendingDeliveries() {
      const ids=(await db.prepare("SELECT id FROM sms_deliveries WHERE outcome='queued' ORDER BY queued_at,id LIMIT 100").all<{id:string}>()).results;
      return ids.map(row=>row.id);
    },
    async claim(id:string,now:string) {
      const result=await db.batch([
        db.prepare("UPDATE sms_deliveries SET outcome='suppressed',outcome_at=? WHERE id=? AND outcome='queued' AND NOT EXISTS(SELECT 1 FROM subscribers s WHERE s.id=sms_deliveries.subscriber_id AND s.state='active')").bind(now,id),
        db.prepare("UPDATE sms_deliveries SET outcome='sending',outcome_at=? WHERE id=? AND outcome='queued' AND EXISTS(SELECT 1 FROM subscribers s WHERE s.id=sms_deliveries.subscriber_id AND s.state='active') RETURNING id").bind(now,id),
      ]);
      return result[1].results.length===1;
    },
    async accepted(id:string,sid:string,now:string) { await db.prepare("UPDATE sms_deliveries SET outcome='sent',provider_message_id=?,outcome_at=? WHERE id=? AND outcome='sending'").bind(sid,now,id).run(); },
    async failed(id:string,now:string) { await db.prepare("UPDATE sms_deliveries SET outcome='failed',outcome_at=? WHERE id=? AND outcome='sending'").bind(now,id).run(); },
    async status(sid:string,status:string,now:string) {
      await db.prepare("UPDATE sms_deliveries SET outcome=?,outcome_at=? WHERE provider_message_id=? AND outcome IN ('sending','sent')").bind(status,now,sid).run();
    },
  };
}
