import type { ManagedMember } from '../../../../modules/business-settings/types.ts';

export interface NativePerson {
  id: string; email: string; displayName: string; role: string; status: string; version: number;
}

/** Identity reads remain in the native account database, never in token claims. */
export function createAgentIdentityRepository(db: D1Database) {
  const columns = 'id,email,display_name AS displayName,role,status,version';
  return {
    async person(id: string) {
      return db.prepare(`SELECT ${columns} FROM oa_operators WHERE id=?`).bind(id).first<NativePerson>();
    },
    async byEmail(email: string) {
      return db.prepare(`SELECT ${columns} FROM oa_operators WHERE email=?`).bind(email).first<NativePerson>();
    },
    async owner() {
      // A deactivated/erased setup owner cannot transfer Business's binding to
      // the next person who acquires the old address or becomes a local owner.
      return db.prepare(`SELECT ${columns} FROM oa_operators WHERE id=(SELECT claim_id FROM oa_bootstrap WHERE singleton=1)`).first<NativePerson>();
    },
    async businessId(sub: string) {
      const owner = await db.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0').first<{owner_id: string | null}>();
      if (!owner) return null;
      if (owner.owner_id === sub) return (await this.owner())?.id ?? null;
      const rows = (await db.prepare("SELECT operator_id FROM bs_team WHERE business_id=? AND state IN ('active','invited') AND operator_id IS NOT NULL")
        .bind(sub).all<{operator_id: string}>()).results;
      return rows.length === 1 ? rows[0].operator_id : null;
    },
    async businessMember(id: string) {
      const settings = await db.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0').first<{owner_id: string | null}>();
      if (!settings) return null;
      if (settings.owner_id && (await this.owner())?.id === id) return {id: settings.owner_id, role: 'owner' as const};
      const rows = (await db.prepare("SELECT business_id,business_role FROM bs_team WHERE operator_id=? AND state IN ('active','invited') AND business_id IS NOT NULL")
        .bind(id).all<{business_id: string; business_role: string | null}>()).results;
      return rows.length === 1 ? {id: rows[0].business_id, role: rows[0].business_role === 'admin' ? 'editor' as const : null} : null;
    },
    async cancellation(id: string) {
      return Boolean(await db.prepare('SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=?').bind(id).first());
    },
    async credential(id: string, sponsor: string) {
      return db.prepare(`SELECT t.id,t.scope,t.read_scope AS readScope,c.operator_id AS personId,c.operator_version AS fence,c.kind
        FROM management_tokens t JOIN oa_credentials c ON c.id=t.id JOIN oa_operators o ON o.id=c.operator_id
        WHERE t.id=? AND t.issuer_id=? AND c.operator_id=t.issuer_id AND t.revoked_at IS NULL
        AND c.revoked_at IS NULL AND c.expires_at>? AND t.expires_at>? AND c.operator_version=o.version
        AND o.status='active' AND o.role IN ('owner','admin')`).bind(id, sponsor, Date.now(), Date.now())
        .first<{id: string; scope: 'metrics:write' | null; readScope: number; personId: string; fence: number; kind: string}>();
    },
    async managed(): Promise<ManagedMember[]> {
      return (await db.prepare('SELECT email,operator_id AS operatorId,invite,state,business_id AS businessId,business_role AS businessRole FROM bs_team ORDER BY email').all<ManagedMember>()).results;
    },
    async revokeInvitation(id: string) {
      await db.prepare('UPDATE oa_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').bind(Date.now(), id).run();
    },
    async invitationCurrent(id: string) {
      return Boolean(await db.prepare(`SELECT 1 FROM oa_tokens t JOIN oa_operators o ON o.id=t.operator_id
        JOIN oa_operators issuer ON issuer.id=t.issuer_id WHERE t.id=? AND t.kind='invite'
        AND t.operator_version=o.version AND o.status='invited' AND t.issuer_version=issuer.version
        AND issuer.status='active' AND issuer.role='owner' AND t.revoked_at IS NULL AND t.consumed_at IS NULL
        AND t.expires_at>?`).bind(id, Date.now()).first());
    },
  };
}
