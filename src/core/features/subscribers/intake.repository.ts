import { agentAttributionStatements } from '../agent-door/provenance.repository';
import { SubscriberLimitError } from "./limits";
import { createUlid } from "../../shared/ids";
import type { IntakeCounts, IntakeRow } from "./intake-schema";

export interface IntakeInsert extends IntakeRow {id:string;tokenHash:string}
export interface AddedBy {id:string;displayName:string}
export interface SubscriberExportRow {channel:string;destination:string;contactEmail:string|null;state:string;components:string;consentAt:string|null}

export function createSubscriberIntakeRepository(db:D1Database) {
  return {
    async operatorAllowed(operatorId:string,owner=false):Promise<boolean> {
      return Boolean(await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND (?=0 OR role='owner')").bind(operatorId,Number(owner)).first());
    },
    async destinations():Promise<Set<string>> {
      return new Set((await db.prepare("SELECT destination FROM subscriber_directory AS subscribers").all<{destination:string}>()).results.map(row=>row.destination));
    },
    async addedBy(subscriberId:string):Promise<AddedBy|null> {
      return db.prepare(`SELECT s.created_by_operator_id AS id,CASE WHEN o.id IS NULL OR o.email='deleted-' || lower(o.id) || '@operator.invalid'
        THEN 'Erased operator · ' || s.created_by_operator_id ELSE COALESCE((SELECT p.agent_name || ' for ' || o.display_name FROM lamp_agent_attribution p WHERE p.entity_type='subscriber' AND p.entity_id=s.id AND p.operator_id=s.created_by_operator_id AND p.created_at=s.created_at ORDER BY p.created_at DESC LIMIT 1),o.display_name) END AS displayName
        FROM subscriber_directory s LEFT JOIN oa_operators o ON o.id=s.created_by_operator_id WHERE s.id=? AND s.created_by_operator_id IS NOT NULL`).bind(subscriberId).first<AddedBy>();
    },
    async has(subscriberId:string):Promise<boolean> {
      return Boolean(await db.prepare("SELECT 1 FROM subscriber_intake WHERE subscriber_id=?").bind(subscriberId).first());
    },
    async insert(rows:IntakeInsert[],operatorId:string,source:"csv"|"operator",batchId:string|null,counts:IntakeCounts,now:string):Promise<string[]> {
      const components=[...new Set(rows.flatMap(row=>row.componentIds))];
      const statements:D1PreparedStatement[]=[db.prepare(`SELECT CASE WHEN
        EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')
        AND (SELECT COUNT(*) FROM components WHERE internal=0 AND id IN (SELECT value FROM json_each(?)))=json_array_length(?)
        THEN 1 ELSE json('Subscriber intake changed.') END`).bind(operatorId,JSON.stringify(components),JSON.stringify(components))];
      const resultPositions:number[]=[];
      for(let start=0;start<rows.length;start+=50) {
        const json=JSON.stringify(rows.slice(start,start+50));
        resultPositions.push(statements.length);
        statements.push(db.prepare(`INSERT INTO subscribers(id,channel,sms_kind,destination,contact_email,state,selection_mode,token_hash,created_by_operator_id,event_kinds_json,minimum_impact,preferences_set,created_at,updated_at)
          SELECT json_extract(r.value,'$.id'),CASE WHEN json_extract(r.value,'$.channel')='sms' THEN 'webhook' ELSE json_extract(r.value,'$.channel') END,CASE WHEN json_extract(r.value,'$.channel')='sms' THEN 1 ELSE 0 END,json_extract(r.value,'$.destination'),json_extract(r.value,'$.contactEmail'),
            'pending',CASE WHEN json_array_length(r.value,'$.componentIds')=0 THEN 'all' ELSE 'selected' END,json_extract(r.value,'$.tokenHash'),?,COALESCE(json_extract(r.value,'$.eventKinds'),CASE WHEN json_extract(r.value,'$.channel')='webhook' THEN '["incidents","maintenance","components"]' ELSE '["incidents","maintenance"]' END),json_extract(r.value,'$.minimumImpact'),1,?,?
          FROM json_each(?) r WHERE 1 ON CONFLICT(destination) DO NOTHING RETURNING id`).bind(operatorId,now,now,json));
        statements.push(db.prepare(`INSERT INTO sms_subscriptions(subscriber_id)
          SELECT s.id FROM json_each(?) r JOIN subscribers s ON s.id=json_extract(r.value,'$.id') WHERE s.sms_kind=1`).bind(json));
        statements.push(db.prepare(`INSERT INTO subscriber_intake(subscriber_id,batch_id,source,operator_id,created_at)
          SELECT s.id,?,?,?,? FROM json_each(?) r JOIN subscriber_directory s ON s.id=json_extract(r.value,'$.id')`).bind(batchId,source,operatorId,now,json));
        statements.push(db.prepare(`UPDATE subscribers SET webhook_format=COALESCE(
          (SELECT json_extract(r.value,'$.webhookFormat') FROM json_each(?) r WHERE json_extract(r.value,'$.id')=subscribers.id),'lamp')
          WHERE channel='webhook' AND id IN (SELECT json_extract(r.value,'$.id') FROM json_each(?) r)`).bind(json,json));
        statements.push(db.prepare(`INSERT INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at)
          SELECT upper(substr(hex(randomblob(16)),1,26)),s.id,c.value,?,? FROM json_each(?) r
          JOIN subscriber_directory s ON s.id=json_extract(r.value,'$.id') CROSS JOIN json_each(r.value,'$.componentIds') c`).bind(now,now,json));
        statements.push(db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
          SELECT ? || '/' || s.id,'subscriber',s.id,?,?,json_object('channel',s.channel),?,?
          FROM json_each(?) r JOIN subscriber_directory s ON s.id=json_extract(r.value,'$.id')`)
          .bind(createUlid(),source==="csv"?"subscriber.imported":"subscriber.added",operatorId,now,now,json));
      }
      for(const row of rows) statements.push(...agentAttributionStatements(db,{entityType:'subscriber',entityId:row.id,operatorId,at:now,guard:{sql:'EXISTS(SELECT 1 FROM subscriber_directory WHERE id=? AND created_by_operator_id=? AND created_at=?)',params:[row.id,operatorId,now]}}));
      if(batchId)statements.push(db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
        SELECT ?,'subscriber-import',?,'subscriber.import-applied',?,json_object('created',COUNT(*),'skipped',?-COUNT(*),'refused',?),?,?
        FROM subscriber_intake WHERE batch_id=?`).bind(batchId,batchId,operatorId,counts.created+counts.skipped,counts.refused,now,now,batchId));
      let results:D1Result<{id:string}>[];
      try{results=await db.batch<{id:string}>(statements);}
      catch(cause){if(cause instanceof Error&&cause.message.includes("over the subscriber limit"))throw new SubscriberLimitError();throw cause;}
      return resultPositions.flatMap(index=>results[index]!.results.map(row=>row.id));
    },
    async batches():Promise<{batchId:string;createdAt:string;remaining:number}[]> {
      return (await db.prepare(`SELECT b.entity_id AS batchId,b.created_at AS createdAt,COUNT(s.id) AS remaining
        FROM audit_entries b LEFT JOIN subscriber_intake a ON a.batch_id=b.entity_id
        LEFT JOIN subscriber_directory s ON s.id=a.subscriber_id AND s.state='pending'
          AND (a.invitation_claimed_at IS NULL OR a.invitation_claimed_at<s.created_at)
          AND julianday(s.created_at,'+72 hours')>julianday('now')
        WHERE b.entity_type='subscriber-import' AND b.action='subscriber.import-applied'
        GROUP BY b.entity_id,b.created_at ORDER BY b.created_at DESC,b.entity_id DESC`)
        .all<{batchId:string;createdAt:string;remaining:number}>()).results;
    },
    async batchExists(batchId:string):Promise<boolean> {
      return Boolean(await db.prepare("SELECT 1 FROM audit_entries WHERE entity_type='subscriber-import' AND entity_id=? AND action='subscriber.import-applied'").bind(batchId).first());
    },
    async pending(batchId:string):Promise<string[]> {
      return (await db.prepare(`SELECT s.id FROM subscriber_intake a JOIN subscriber_directory s ON s.id=a.subscriber_id
        WHERE a.batch_id=? AND (a.invitation_claimed_at IS NULL OR a.invitation_claimed_at<s.created_at) AND s.state='pending'
          AND julianday(s.created_at,'+72 hours')>julianday('now') ORDER BY s.id LIMIT 50`).bind(batchId).all<{id:string}>()).results.map(row=>row.id);
    },
    async remaining(batchId:string):Promise<number> {
      return Number((await db.prepare(`SELECT COUNT(*) AS count FROM subscriber_intake a JOIN subscriber_directory s ON s.id=a.subscriber_id
        WHERE a.batch_id=? AND (a.invitation_claimed_at IS NULL OR a.invitation_claimed_at<s.created_at) AND s.state='pending'
          AND julianday(s.created_at,'+72 hours')>julianday('now')`).bind(batchId).first<{count:number}>())?.count??0);
    },
    async claimInvitation(subscriberId:string,emailHash:string,now:string,operatorId:string|null,ownerOnly:boolean):Promise<boolean> {
      const cutoff=new Date(Date.parse(now)-24*60*60_000).toISOString();
      const auditId=createUlid();
      const allowed=`EXISTS(SELECT 1 FROM subscriber_intake a JOIN subscriber_directory s ON s.id=a.subscriber_id
        WHERE s.id=? AND s.state='pending' AND (a.invitation_claimed_at IS NULL OR a.invitation_claimed_at<s.created_at) AND julianday(s.created_at,'+72 hours')>julianday('now'))
        AND (? IS NULL OR EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND (?=0 OR role='owner')))`;
      const [slot]=await db.batch([
        db.prepare(`INSERT INTO subscriber_confirmation_attempts(email_hash,last_sent_at,created_at,updated_at)
          SELECT ?,?,?,? WHERE ${allowed}
          ON CONFLICT(email_hash) DO UPDATE SET last_sent_at=excluded.last_sent_at,updated_at=excluded.updated_at
          WHERE subscriber_confirmation_attempts.last_sent_at<? RETURNING email_hash`)
          .bind(emailHash,now,now,now,subscriberId,operatorId,operatorId,Number(ownerOnly),cutoff),
        db.prepare(`UPDATE subscriber_intake SET invitation_claimed_at=? WHERE subscriber_id=? AND changes()=1`).bind(now,subscriberId),
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
          SELECT ?,'subscriber',?,'subscriber.invitation-requested',?,'{}',?,? WHERE changes()=1`)
          .bind(auditId,subscriberId,operatorId,now,now),
        ...(operatorId?agentAttributionStatements(db,{entityType:'subscriber',entityId:subscriberId,operatorId,at:now,guard:{sql:'EXISTS(SELECT 1 FROM audit_entries WHERE id=?)',params:[auditId]}}):[]),
      ]);
      return slot.results.length===1;
    },
    async releasePreparationClaim(subscriberId:string,emailHash:string,claimedAt:string):Promise<void> {
      await db.batch([
        db.prepare("UPDATE subscriber_intake SET invitation_claimed_at=NULL WHERE subscriber_id=? AND invitation_claimed_at=?").bind(subscriberId,claimedAt),
        db.prepare("DELETE FROM subscriber_confirmation_attempts WHERE email_hash=? AND last_sent_at=? AND changes()=1").bind(emailHash,claimedAt),
      ]);
    },
    async exportRows():Promise<SubscriberExportRow[]> {
      return (await db.prepare(`SELECT s.channel,s.destination,s.contact_email AS contactEmail,s.state,
        COALESCE((SELECT group_concat(component_id,';') FROM (SELECT component_id FROM subscriber_components WHERE subscriber_id=s.id ORDER BY component_id)),'') AS components,
        CASE WHEN s.channel='sms' THEN (SELECT MAX(consent.consented_at) FROM sms_consents consent WHERE consent.subscriber_id=s.id AND consent.consented_at>=s.created_at)
          WHEN a.subscriber_id IS NOT NULL THEN CASE WHEN a.confirmed_at>=s.created_at THEN a.confirmed_at END
          ELSE (SELECT MAX(t.revoked_at) FROM subscriber_tokens t WHERE t.subscriber_id=s.id AND t.scope='confirm'
          AND t.revoked_at IS NOT NULL AND (s.deactivated_at IS NULL OR t.revoked_at<s.deactivated_at)) END AS consentAt
        FROM subscriber_directory s LEFT JOIN subscriber_intake a ON a.subscriber_id=s.id
        WHERE s.destination<>'deleted:' || s.id ORDER BY s.created_at,s.id`).all<SubscriberExportRow>()).results;
    },
  };
}
export type SubscriberIntakeRepository=ReturnType<typeof createSubscriberIntakeRepository>;
