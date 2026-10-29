import { createUlid, nowIso } from "../../shared/ids";
export interface TokenAuthority { id: string; personId: string; fence: number; kind: string }
export type ManagementScope = "read" | "metrics:write" | "subscribers:write" | "subscribers:read";
export interface ManagementToken { id: string; name: string; scopes: ManagementScope[]; issuerId: string; expiresAt: number; lastUsedAt: number | null; revokedAt: number | null }
interface TokenRow extends Omit<ManagementToken,"scopes"> { scope: "metrics:write" | null; readScope: number; subscriberWriteScope: number; subscriberReadScope:number }
export class TokenAuthorityError extends Error {}
/** This fence is repeated inside the aggregate write transaction. Metadata alone
 * never grants authority, including after an archive restores without credentials. */
export function tokenFence(authority: TokenAuthority, scope: ManagementScope = "metrics:write") {
  return {
    sql: `EXISTS(SELECT 1 FROM management_tokens t JOIN oa_credentials c ON c.id=t.id JOIN oa_operators o ON o.id=c.operator_id
      WHERE t.id=? AND t.issuer_id=? AND ${scope === 'read' ? 't.read_scope=1' : scope === 'subscribers:read' ? 't.subscriber_read_scope=1' : scope === 'subscribers:write' ? 't.subscriber_write_scope=1' : "t.scope='metrics:write'"} AND t.revoked_at IS NULL
      AND c.operator_id=t.issuer_id AND c.operator_version=? AND c.kind=? AND c.revoked_at IS NULL
      AND c.expires_at>unixepoch('subsec')*1000 AND o.version=c.operator_version AND o.status='active' AND o.role IN ('owner','admin'))`,
    params: [authority.id,authority.personId,authority.fence,authority.kind],
  };
}
export function createManagementTokenRepository(db: D1Database) {
  const manager=(actor:string,version:number)=>({sql:"EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin'))",params:[actor,version]});
  const columns="t.id,t.name,t.scope,t.read_scope AS readScope,t.subscriber_write_scope AS subscriberWriteScope,t.subscriber_read_scope AS subscriberReadScope,t.issuer_id AS issuerId,t.expires_at AS expiresAt,t.last_used_at AS lastUsedAt,t.revoked_at AS revokedAt";
  const view=(row:TokenRow):ManagementToken=>{const {scope,readScope,subscriberWriteScope,subscriberReadScope,...fields}=row;return {...fields,scopes:[...(readScope?["read" as const]:[]),...(scope?[scope]:[]),...(subscriberWriteScope?["subscribers:write" as const]:[]),...(subscriberReadScope?["subscribers:read" as const]:[])]};};
  return {
    async isManager(actor:string) {return Boolean(await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')").bind(actor).first());},
    async create(input:{id:string;name:string;scope:"metrics:write"|null;readScope:boolean;subscriberWriteScope:boolean;subscriberReadScope:boolean;expiresAt:number},actor:string,version:number) {
      const fence=manager(actor,version),at=nowIso(),receipt=createUlid();
      const result=await db.batch([
        db.prepare(`INSERT INTO management_tokens(id,name,scope,read_scope,subscriber_write_scope,subscriber_read_scope,issuer_id,expires_at,created_at)
          SELECT ?,?,?,?,?,?,?,?,? WHERE ${fence.sql} AND EXISTS(SELECT 1 FROM oa_credentials WHERE id=? AND operator_id=? AND operator_version=? AND revoked_at IS NULL AND expires_at>unixepoch('subsec')*1000)`)
          .bind(input.id,input.name,input.scope,input.readScope?1:0,input.subscriberWriteScope?1:0,input.subscriberReadScope?1:0,actor,input.expiresAt,at,...fence.params,input.id,actor,version),
        db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?,'management-token',id,'management-token.created',?,'{}',?,? FROM management_tokens WHERE id=?")
          .bind(receipt,actor,at,at,input.id),
      ]);
      return Boolean(result[0].meta.changes);
    },
    async discardUnscopedCredential(id:string,actor:string) {
      await db.prepare("UPDATE oa_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND operator_id=? AND NOT EXISTS(SELECT 1 FROM management_tokens WHERE id=?)").bind(Date.now(),id,actor,id).run();
    },
    async recordRead(authority:TokenAuthority,scope:ManagementScope="read") {
      const fence=tokenFence(authority,scope);
      const result=await db.prepare(`UPDATE management_tokens SET last_used_at=? WHERE id=? AND ${fence.sql}`).bind(Date.now(),authority.id,...fence.params).run();
      return Boolean(result.meta.changes);
    },
    async list() {return (await db.prepare(`SELECT ${columns} FROM management_tokens t ORDER BY t.created_at,t.id`).all<TokenRow>()).results.map(view);},
    async get(id:string) {const row=await db.prepare(`SELECT ${columns} FROM management_tokens t WHERE t.id=?`).bind(id).first<TokenRow>();return row?view(row):null;},
    async revoke(id:string,actor:string,version:number) {
      const fence=manager(actor,version),at=nowIso(),now=Date.now(),receipt=createUlid();
      const witness="EXISTS(SELECT 1 FROM audit_entries WHERE id=?)";
      const result=await db.batch([
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
          SELECT ?,'management-token',id,'management-token.revoked',?,'{}',?,? FROM management_tokens WHERE id=? AND revoked_at IS NULL AND ${fence.sql}`)
          .bind(receipt,actor,at,at,id,...fence.params),
        db.prepare(`UPDATE management_tokens SET revoked_at=? WHERE id=? AND ${witness}`).bind(now,id,receipt),
        db.prepare(`UPDATE oa_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND ${witness}`).bind(now,id,receipt),
      ]);
      return Boolean(result[0].meta.changes);
    },
  };
}
