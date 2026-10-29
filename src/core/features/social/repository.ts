import { createUlid, nowIso } from "../../shared/ids";
import type { SocialNetwork } from "./networks";

export interface SocialAccount { id:string; network:SocialNetwork; name:string; prefix:string; host:string; identifier:string; sealedCredential:string; createdAt:string }
export interface SocialPost { id:string; eventId:string; accountId:string; incidentId:string|null; maintenanceId:string|null; reference:string; lifecycle:string; customerImpact:string; prefix:string; queuedAt:string; body:string|null; text:string|null; postId:string|null; postCid:string|null }
const accountColumns='id,network,name,prefix,host,identifier,sealed_credential AS sealedCredential,created_at AS createdAt';
const postColumns='p.id,p.event_id AS eventId,p.account_id AS accountId,p.incident_id AS incidentId,p.maintenance_id AS maintenanceId,p.reference,p.lifecycle,p.customer_impact AS customerImpact,p.prefix,p.queued_at AS queuedAt,p.body,p.text,p.post_id AS postId,p.post_cid AS postCid';
export function createSocialRepository(db:D1Database) {
  return {
    async accounts() { return (await db.prepare(`SELECT ${accountColumns} FROM social_accounts WHERE removed_at IS NULL ORDER BY created_at,id`).all<SocialAccount>()).results; },
    async account(id:string) { return db.prepare(`SELECT ${accountColumns} FROM social_accounts WHERE id=? AND removed_at IS NULL`).bind(id).first<SocialAccount>(); },
    async add(account:SocialAccount,operatorId:string) {
      await db.prepare('INSERT INTO social_accounts(id,network,name,prefix,host,identifier,sealed_credential,created_by_operator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(account.id,account.network,account.name,account.prefix,account.host,account.identifier,account.sealedCredential,operatorId,account.createdAt).run();
    },
    async remove(id:string,operatorId:string) {
      const now=nowIso();
      const result=await db.batch([
        db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?,'social-account',id,'deleted',?,json_object('network',network,'name',name),?,? FROM social_accounts WHERE id=? AND removed_at IS NULL").bind(createUlid(),operatorId,now,now,id),
        db.prepare('UPDATE social_accounts SET removed_at=? WHERE id=? AND removed_at IS NULL').bind(now,id),
      ]);
      return result[1].meta.changes===1;
    },
    async postByDefault() { return Boolean((await db.prepare("SELECT post_by_default AS enabled FROM social_settings WHERE id='default'").first<{enabled:number}>())?.enabled); },
    async setDefault(enabled:boolean) { await db.prepare("INSERT INTO social_settings(id,post_by_default) VALUES('default',?) ON CONFLICT(id) DO UPDATE SET post_by_default=excluded.post_by_default").bind(enabled?1:0).run(); },
    publicationStatements(input:{updateId:string;queuedAt:string}) {
      return [db.prepare(`INSERT OR IGNORE INTO social_posts(id,event_id,account_id,incident_id,reference,lifecycle,customer_impact,prefix,queued_at)
        SELECT u.id||'.'||a.id,u.id,a.id,i.id,i.reference,u.lifecycle,u.customer_impact,a.prefix,?
        FROM incident_updates u JOIN incidents i ON i.id=u.incident_id CROSS JOIN social_accounts a
        WHERE u.id=? AND a.removed_at IS NULL AND i.deleted_at IS NULL AND u.is_retroactive=0`).bind(input.queuedAt,input.updateId)];
    },
    maintenanceStatements(input:{eventId:string;maintenanceId:string;queuedAt:string}) {
      return [db.prepare(`INSERT OR IGNORE INTO social_posts(id,event_id,account_id,maintenance_id,reference,lifecycle,customer_impact,prefix,queued_at)
        SELECT n.id||'.'||a.id,n.id,a.id,m.id,m.reference,m.state,COALESCE(m.customer_impact,n.body),a.prefix,?
        FROM maintenance_notices n JOIN maintenance m ON m.id=n.maintenance_id CROSS JOIN social_accounts a
        WHERE n.id=? AND m.id=? AND a.removed_at IS NULL`).bind(input.queuedAt,input.eventId,input.maintenanceId)];
    },
    async pending(limit:number) {
      // Earlier unresolved posts serialize each account's incident thread. Other
      // accounts keep moving even when one provider is down.
      return (await db.prepare(`SELECT ${postColumns} FROM social_posts p JOIN social_accounts a ON a.id=p.account_id
        WHERE a.removed_at IS NULL AND p.post_id IS NULL AND NOT EXISTS(SELECT 1 FROM integration_deliveries d WHERE d.namespace='lamp-social' AND d.id=p.id)
        AND NOT EXISTS(SELECT 1 FROM social_posts earlier LEFT JOIN integration_deliveries d ON d.namespace='lamp-social' AND d.id=earlier.id
          WHERE p.incident_id IS NOT NULL AND earlier.incident_id=p.incident_id AND earlier.account_id=p.account_id
          AND (earlier.queued_at<p.queued_at OR (earlier.queued_at=p.queued_at AND earlier.id<p.id))
          AND earlier.post_id IS NULL AND (d.state IS NULL OR d.state IN ('queued','sending','uncertain')))
        ORDER BY p.queued_at,p.id LIMIT ?`).bind(limit).all<SocialPost>()).results;
    },
    async post(id:string) { return db.prepare(`SELECT ${postColumns} FROM social_posts p WHERE p.id=?`).bind(id).first<SocialPost>(); },
    async thread(post:SocialPost) {
      if(!post.incidentId)return [];
      return (await db.prepare(`SELECT post_id AS id,post_cid AS cid FROM social_posts WHERE incident_id=? AND account_id=? AND post_id IS NOT NULL AND (queued_at<? OR (queued_at=? AND id<?)) ORDER BY queued_at,id`).bind(post.incidentId,post.accountId,post.queuedAt,post.queuedAt,post.id).all<{id:string;cid?:string}>()).results;
    },
    async freeze(id:string,text:string,body:string) {
      await db.prepare('UPDATE social_posts SET body=?,text=? WHERE id=? AND body IS NULL').bind(body,text,id).run();
      return this.post(id);
    },
    async receipt(id:string,receipt:{id:string;cid?:string}) {
      await db.prepare('UPDATE social_posts SET post_id=?,post_cid=?,delivered_at=? WHERE id=? AND post_id IS NULL').bind(receipt.id,receipt.cid??null,nowIso(),id).run();
    },
    async log(limit=100) {
      const rows=(await db.prepare(`SELECT p.id,p.event_id AS eventId,p.account_id AS accountId,a.name AS account,a.network,p.reference,p.text,p.queued_at AS queuedAt,COALESCE(p.delivered_at,CASE WHEN d.state IN ('rejected','uncertain') THEN strftime('%Y-%m-%dT%H:%M:%fZ',(SELECT MAX(finished_at) FROM integration_attempts a WHERE a.namespace='lamp-social' AND a.delivery_id=p.id)/1000.0,'unixepoch') END) AS outcomeAt,p.post_id AS postId,p.post_cid AS postCid,COALESCE(d.attempts,0) AS attempts,
        CASE WHEN p.post_id IS NOT NULL THEN 'delivered' WHEN d.state IN ('rejected','uncertain') THEN 'failed' ELSE 'queued' END AS state
        FROM social_posts p JOIN social_accounts a ON a.id=p.account_id LEFT JOIN integration_deliveries d ON d.namespace='lamp-social' AND d.id=p.id ORDER BY p.queued_at DESC,p.id DESC LIMIT ?`).bind(limit).all<{id:string;eventId:string;accountId:string;account:string;network:SocialNetwork;reference:string;text:string|null;queuedAt:string;outcomeAt:string|null;postId:string|null;postCid:string|null;attempts:number;state:string}>()).results;
      return Promise.all(rows.map(async row=>({...row,attemptLog:(await db.prepare("SELECT number,started_at AS startedAt,finished_at AS finishedAt,outcome FROM integration_attempts WHERE namespace='lamp-social' AND delivery_id=? ORDER BY number").bind(row.id).all()).results})));
    },
    async failed() { return (await db.prepare("SELECT p.id FROM social_posts p JOIN integration_deliveries d ON d.id=p.id AND d.namespace='lamp-social' WHERE p.post_id IS NULL AND d.state IN ('rejected','uncertain')").all<{id:string}>()).results; },
  };
}
