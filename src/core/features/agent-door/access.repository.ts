import { createManagementTokenRepository } from '../management-api/repository';
import { createOperatorRepository } from '../operators/repository';
import { createChatLinksRepository } from '../chat-desk/links.repository';

/** Native account reads used by the door. No token address selects an account. */
export function createAgentAccessRepository(db: D1Database) {
  const tokens = createManagementTokenRepository(db);
  const operators = createOperatorRepository(db);
  const links = createChatLinksRepository(db);
  return {
    tokens, operators, links,
    async actor(id: string) {
      return db.prepare("SELECT id,email,display_name AS displayName,role,status,version FROM oa_operators WHERE id=? AND status='active' AND role='owner'")
        .bind(id).first<{ id: string; email: string; displayName: string; role: 'owner'; status: 'active'; version: number }>();
    },
    async effectiveTokenGrants(id: string) {
      const row = await db.prepare(`SELECT t.scope,t.read_scope AS readScope FROM management_tokens t
        JOIN oa_credentials c ON c.id=t.id JOIN oa_operators o ON o.id=c.operator_id
        WHERE t.id=? AND t.issuer_id=c.operator_id AND t.revoked_at IS NULL AND c.revoked_at IS NULL
          AND c.expires_at>unixepoch('subsec')*1000 AND t.expires_at>unixepoch('subsec')*1000
          AND o.status='active' AND o.role='owner' AND o.version=c.operator_version`)
        .bind(id).first<{ scope: string | null; readScope: number }>();
      return row ? [...(row.readScope ? ['management:read'] : []), ...(row.scope ? [`management:${row.scope}`] : [])] : [];
    },
    async subscriber(id: string) {
      return db.prepare("SELECT id,channel,state,destination,contact_email AS contactEmail,updated_at AS updatedAt FROM subscriber_directory WHERE id=? AND destination<>('deleted:' || id)")
        .bind(id).first<{ id: string; channel: string; state: string; destination: string; contactEmail: string | null; updatedAt: string }>();
    },
  };
}
