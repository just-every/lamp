import { agentOperatorErasureStatements } from './agent-erasure.repository';
import { sessionAuthority } from '../../platform/auth/authority';
import { createUlid, nowIso } from '../../shared/ids';
import { AuthError, type Operator, type Session } from '@runeditrun/rer/modules/operator-auth';
export interface StoredOperator { id: string; email: string; displayName: string; isSetupOperator: boolean }
export interface StoredFormerOperator extends StoredOperator { deactivatedAt: string }
export function createOperatorRepository(db: D1Database) {
  return {
    async isSetupOperator(id: string) { return Boolean(await db.prepare('SELECT 1 FROM oa_bootstrap WHERE claim_id=?').bind(id).first()); },
    async view(operator: Operator): Promise<StoredOperator> { return { id: operator.id, email: operator.email, displayName: operator.displayName, isSetupOperator: await this.isSetupOperator(operator.id) }; },
    async version(id: string) {return db.prepare('SELECT version,status FROM oa_operators WHERE id=?').bind(id).first<{version:number;status:string}>();},
    async initialized() { return Boolean(await db.prepare('SELECT 1 FROM oa_bootstrap').first()); },
    async listOperators(): Promise<StoredOperator[]> {
      return (await db.prepare("SELECT o.id,o.email,o.display_name AS displayName,CASE WHEN b.claim_id=o.id THEN 1 ELSE 0 END AS isSetupOperator FROM oa_operators o LEFT JOIN oa_bootstrap b ON b.singleton=1 WHERE o.status='active' ORDER BY o.email").all<StoredOperator>()).results;
    },
    async listInvitedOperators(): Promise<StoredOperator[]> {
      return (await db.prepare("SELECT id,email,display_name AS displayName,0 AS isSetupOperator FROM oa_operators WHERE status='invited' ORDER BY email").all<StoredOperator>()).results;
    },
    async listFormerOperators(): Promise<StoredFormerOperator[]> {
      return (await db.prepare("SELECT p.id,p.email,p.display_name AS displayName,EXISTS(SELECT 1 FROM oa_bootstrap WHERE claim_id=p.id) AS isSetupOperator,p.deactivated_at AS deactivatedAt FROM operators p JOIN oa_operators o ON o.id=p.id WHERE o.status='inactive' AND p.email <> 'deleted-' || lower(p.id) || '@operator.invalid' ORDER BY p.email").all<StoredFormerOperator>()).results;
    },
    async recordInvitation(email: string, actor: string) {
      const now=nowIso();
      await db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?,'operator',id,'invited',?,'{}',?,? FROM oa_operators WHERE email=? AND status='invited'").bind(createUlid(),actor,now,now,email.trim().toLowerCase()).run();
    },
    async recordRevocation(id: string, actor: string) {
      const now = nowIso();
      await db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES (?,'operator',?,'access-revoked',?,'{}',?,?)").bind(createUlid(),id,actor,now,now).run();
    },
    // Base first cancels the invitation or deactivates the operator. The receipt
    // captures the complete target/actor fence inside the same atomic D1 batch
    // as every erasure write. Later statements use that transaction's receipt:
    // removing the actor's own provider/session data cannot cut erasure short.
    async erase(target: Operator, session: Session) {
      const id = target.id, actor = session.operator.id;
      if (id === actor && target.version !== session.operator.version + 1) throw new AuthError('authority_changed', 409);
      const authority = sessionAuthority(session, id === actor ? target.version : undefined);
      const fence = `EXISTS(SELECT 1 FROM oa_operators target WHERE target.id=? AND target.version=? AND target.status='inactive')
        AND (?=? OR NOT EXISTS(SELECT 1 FROM oa_bootstrap WHERE claim_id=?)) AND ${authority.sql}`;
      const args = [id, target.version, id, actor, id, ...authority.params];
      const now = nowIso(), revokedAt = Date.now(), receipt = createUlid();
      const witnessed = "EXISTS(SELECT 1 FROM audit_entries WHERE id=? AND entity_type='operator' AND entity_id=? AND action='deleted' AND operator_id=?)";
      const witness = [receipt, id, actor];
      const results = await db.batch([
        db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?,'operator',?,'deleted',?,'{}',?,? WHERE " + fence).bind(receipt, id, actor, now, now, ...args),
        db.prepare("UPDATE oa_operators SET email='deleted-' || lower(id) || '@operator.invalid',display_name='Erased operator',version=version+1 WHERE id=? AND " + witnessed).bind(id, ...witness),
        db.prepare("UPDATE oc_owner_claims SET email='deleted-' || lower(operator_id) || '@operator.invalid' WHERE operator_id=? AND " + witnessed).bind(id, ...witness),
        db.prepare("UPDATE oc_idp_grants SET subject='erased:' || ? WHERE jti IN (SELECT jti FROM oc_owner_claims WHERE operator_id=?) AND EXISTS(SELECT 1 FROM oa_external_identities identity WHERE identity.operator_id=? AND identity.issuer=oc_idp_grants.issuer AND identity.subject=oc_idp_grants.subject) AND " + witnessed).bind(id, id, id, ...witness),
        db.prepare('DELETE FROM oa_external_identities WHERE operator_id=? AND ' + witnessed).bind(id, ...witness),
        db.prepare('DELETE FROM oa_provider_sessions WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?) AND ' + witnessed).bind(id, ...witness),
        db.prepare('DELETE FROM oa_provider_session_pins WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?) AND ' + witnessed).bind(id, ...witness),
        db.prepare('UPDATE oa_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE (operator_id=? OR issuer_id=?) AND ' + witnessed).bind(revokedAt, id, id, ...witness),
        db.prepare('UPDATE oa_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=? AND ' + witnessed).bind(revokedAt, id, ...witness),
        db.prepare('DELETE FROM oa_step_up_challenges WHERE operator_id=? AND ' + witnessed).bind(id, ...witness),
        db.prepare('UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=? AND ' + witnessed).bind(revokedAt, id, ...witness),
        db.prepare("UPDATE audit_entries SET reason=NULL,payload_json='{}',updated_at=? WHERE entity_type='operator' AND entity_id=? AND " + witnessed).bind(now, id, ...witness),
        ...agentOperatorErasureStatements(db, { id, actor, receipt, now }),
      ]);
      if (!results[0].meta.changes) throw new AuthError('authority_changed', 409);
    },
  };
}
