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
      return new Set((await db.prepare("SELECT destination FROM subscribers").all<{destination:string}>()).results.map(row=>row.destination));
    },
    async addedBy(subscriberId:string):Promise<AddedBy|null> {
      return db.prepare(`SELECT s.created_by_operator_id AS id,CASE WHEN o.id IS NULL OR o.email='deleted-' || lower(o.id) || '@operator.invalid'
        THEN 'Erased operator · ' || s.created_by_operator_id ELSE o.display_name END AS displayName
        FROM subscribers s LEFT JOIN oa_operators o ON o.id=s.created_by_operator_id WHERE s.id=? AND s.created_by_operator_id IS NOT NULL`).bind(subscriberId).first<AddedBy>();
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
      for(let start=0;start<rows.length;start+=25) {
        const json=JSON.stringify(rows.slice(start,start+25));
        resultPositions.push(statements.length);
        statements.push(db.prepare(`INSERT INTO subscribers(id,channel,destination,contact_email,state,selection_mode,token_hash,created_by_operator_id,created_at,updated_at)
          SELECT json_extract(r.value,'$.id'),json_extract(r.value,'$.channel'),json_extract(r.value,'$.destination'),json_extract(r.value,'$.contactEmail'),
            'pending',CASE WHEN json_array_length(r.value,'$.componentIds')=0 THEN 'all' ELSE 'selected' END,json_extract(r.value,'$.tokenHash'),?,?,?
          FROM json_each(?) r WHERE 1 ON CONFLICT(destination) DO NOTHING RETURNING id`).bind(operatorId,now,now,json));
        statements.push(db.prepare(`INSERT INTO subscriber_intake(subscriber_id,batch_id,source,operator_id,created_at)
          SELECT s.id,?,?,?,? FROM json_each(?) r JOIN subscribers s ON s.id=json_extract(r.value,'$.id')`).bind(batchId,source,operatorId,now,json));
        statements.push(db.prepare(`INSERT INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at)
          SELECT upper(substr(hex(randomblob(16)),1,26)),s.id,c.value,?,? FROM json_each(?) r
          JOIN subscribers s ON s.id=json_extract(r.value,'$.id') CROSS JOIN json_each(r.value,'$.componentIds') c`).bind(now,now,json));
        statements.push(db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
          SELECT ? || '/' || s.id,'subscriber',s.id,?,?,json_object('channel',s.channel),?,?
          FROM json_each(?) r JOIN subscribers s ON s.id=json_extract(r.value,'$.id')`)
          .bind(createUlid(),source==="csv"?"subscriber.imported":"subscriber.added",operatorId,now,now,json));
      }
      if(batchId)statements.push(db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
        SELECT ?,'subscriber-import',?,'subscriber.import-applied',?,json_object('created',COUNT(*),'skipped',?-COUNT(*),'refused',?),?,?
        FROM subscriber_intake WHERE batch_id=?`).bind(batchId,batchId,operatorId,counts.created+counts.skipped,counts.refused,now,now,batchId));
      const results=await db.batch<{id:string}>(statements);
      return resultPositions.flatMap(index=>results[index]!.results.map(row=>row.id));
    },
    async batchExists(batchId:string):Promise<boolean> {
      return Boolean(await db.prepare("SELECT 1 FROM audit_entries WHERE entity_type='subscriber-import' AND entity_id=? AND action='subscriber.import-applied'").bind(batchId).first());
    },
    async pending(batchId:string):Promise<string[]> {
      return (await db.prepare(`SELECT s.id FROM subscriber_intake a JOIN subscribers s ON s.id=a.subscriber_id
        WHERE a.batch_id=? AND (a.invitation_claimed_at IS NULL OR a.invitation_claimed_at<s.created_at) AND s.state='pending'
          AND julianday(s.created_at,'+72 hours')>julianday('now') ORDER BY s.id LIMIT 50`).bind(batchId).all<{id:string}>()).results.map(row=>row.id);
    },
    async remaining(batchId:string):Promise<number> {
      return Number((await db.prepare(`SELECT COUNT(*) AS count FROM subscriber_intake a JOIN subscribers s ON s.id=a.subscriber_id
        WHERE a.batch_id=? AND (a.invitation_claimed_at IS NULL OR a.invitation_claimed_at<s.created_at) AND s.state='pending'
          AND julianday(s.created_at,'+72 hours')>julianday('now')`).bind(batchId).first<{count:number}>())?.count??0);
    },
    async claimInvitation(subscriberId:string,emailHash:string,now:string,operatorId:string|null,ownerOnly:boolean):Promise<boolean> {
      const cutoff=new Date(Date.parse(now)-24*60*60_000).toISOString();
      const allowed=`EXISTS(SELECT 1 FROM subscriber_intake a JOIN subscribers s ON s.id=a.subscriber_id
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
          .bind(createUlid(),subscriberId,operatorId,now,now),
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
        CASE WHEN a.subscriber_id IS NOT NULL THEN CASE WHEN a.confirmed_at>=s.created_at THEN a.confirmed_at END
          ELSE (SELECT MAX(t.revoked_at) FROM subscriber_tokens t WHERE t.subscriber_id=s.id AND t.scope='confirm'
          AND t.revoked_at IS NOT NULL AND (s.deactivated_at IS NULL OR t.revoked_at<s.deactivated_at)) END AS consentAt
        FROM subscribers s LEFT JOIN subscriber_intake a ON a.subscriber_id=s.id
        WHERE s.destination<>'deleted:' || s.id ORDER BY s.created_at,s.id`).all<SubscriberExportRow>()).results;
    },
  };
}
export type SubscriberIntakeRepository=ReturnType<typeof createSubscriberIntakeRepository>;
