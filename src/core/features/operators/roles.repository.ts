import { AuthError, type Operator, type Session } from '@runeditrun/rer/modules/operator-auth';
import { sessionAuthority } from '../../platform/auth/authority';
import { createUlid, nowIso } from '../../shared/ids';
import { OPERATOR_ROLES, type OperatorRole } from './permissions';

export function createOperatorRolesRepository(db: D1Database) {
  return {
    async role(id: string): Promise<OperatorRole | null> {
      const row = await db.prepare("SELECT CASE WHEN o.role IN ('owner','admin') THEN o.role ELSE COALESCE(r.role,'viewer') END AS role FROM oa_operators o LEFT JOIN operator_roles r ON r.operator_id=o.id WHERE o.id=? AND o.status='active'").bind(id).first<{ role: OperatorRole }>();
      return row?.role ?? null;
    },
    async denied(operator: string, method: string, path: string) {
      const at = nowIso();
      await db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,reason,payload_json,created_at,updated_at) VALUES(?,'operator-access',?,'access-denied',?,?,'{}',?,?)")
        .bind(createUlid(), path, operator, `${method} ${path}`, at, at).run();
    },
    async change(session: Session, target: Operator, role: OperatorRole) {
      if (!OPERATOR_ROLES.includes(role)) throw new AuthError('invalid_role', 400);
      const before = target.role === 'member'
        ? (await db.prepare('SELECT role FROM operator_roles WHERE operator_id=?').bind(target.id).first<{ role: OperatorRole }>())?.role ?? 'viewer'
        : target.role;
      if (before === role) return;
      const authority = sessionAuthority(session);
      const id = createUlid(), at = nowIso();
      const witness = "EXISTS(SELECT 1 FROM audit_entries WHERE id=? AND action='role-changed')";
      const coarse = role === 'owner' || role === 'admin' ? role : 'member';
      try {
        const results = await db.batch([
          db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,reason,payload_json,created_at,updated_at)
            SELECT ?,'operator',?,'role-changed',?,?,?,?,? WHERE ${authority.sql}
            AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=?)`)
            .bind(id,target.id,session.operator.id,`${before} → ${role}`,JSON.stringify({from:before,to:role}),at,at,...authority.params,target.id,target.version),
          db.prepare(`UPDATE oa_operators SET role=? WHERE id=? AND ${witness}`).bind(coarse,target.id,id),
          ...(coarse === 'member'
            ? [db.prepare(`INSERT INTO operator_roles(operator_id,role) SELECT ?,? WHERE ${witness} ON CONFLICT(operator_id) DO UPDATE SET role=excluded.role`).bind(target.id,role,id)]
            : [db.prepare(`DELETE FROM operator_roles WHERE operator_id=? AND ${witness}`).bind(target.id,id)]),
          db.prepare(`UPDATE oa_operators SET version=version+1 WHERE id=? AND ${witness}`).bind(target.id,id),
          db.prepare(`DELETE FROM chat_previews WHERE operator_id=? AND ${witness}`).bind(target.id,id),
          db.prepare(`DELETE FROM chat_link_codes WHERE operator_id=? AND ${witness}`).bind(target.id,id),
          db.prepare(`UPDATE incident_drafts SET reviewed_by_operator_id=NULL,reviewed_at=NULL WHERE reviewed_by_operator_id=? AND ${witness}`).bind(target.id,id),
          // A previously authorized scheduled update cannot outlive its author’s
          // publication role. The saved draft remains available to the team.
          ...(!['owner','admin','communicator'].includes(role) ? [db.prepare(`UPDATE incident_drafts SET scheduled_publish_at=NULL,scheduled_channels_json='[]' WHERE author_operator_id=? AND ${witness}`).bind(target.id,id)] : []),
        ]);
        if (!results[0].meta.changes) throw new AuthError('authority_changed',409);
      } catch (error) {
        if (String(error).includes('last_owner')) throw new AuthError('last_owner',409);
        throw error;
      }
    },
  };
}
