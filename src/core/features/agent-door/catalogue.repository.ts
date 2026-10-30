import type { TokenAuthority } from '../management-api/repository';
import { createComponentRepository } from '../components/repository';
import { mostSevereState, type ComponentState } from '../../shared/domain';

export function createCatalogueDoorRepository(db: D1Database) {
  return {
    async standingClaimOutcome(id:string,state:ComponentState|null) {
      const claims=(await createComponentRepository(db).listCurrentClaims()).filter(item=>item.componentId===id&&item.causeType!=='standing-claim').map(item=>item.state);
      return mostSevereState([...claims,...(state?[state]:[])]);
    },
    async managementAuthority(id: string, personId: string): Promise<TokenAuthority | null> {
      return db.prepare(`SELECT t.id,t.issuer_id AS personId,c.operator_version AS fence,c.kind
        FROM management_tokens t JOIN oa_credentials c ON c.id=t.id JOIN oa_operators o ON o.id=c.operator_id
        WHERE t.id=? AND t.issuer_id=? AND t.scope='metrics:write' AND t.revoked_at IS NULL
          AND c.operator_id=t.issuer_id AND c.revoked_at IS NULL AND c.expires_at>unixepoch('subsec')*1000
          AND o.version=c.operator_version AND o.status='active' AND o.role IN ('owner','admin')`).bind(id,personId).first<TokenAuthority>();
    },
    async metricRevision(id: string) {
      return (await db.prepare('SELECT version FROM public_metrics WHERE id=?').bind(id).first<{ version: number }>())?.version ?? null;
    },
    async componentRevision(id: string) {
      return (await db.prepare(`SELECT c.updated_at || ':' || COALESCE((SELECT id FROM component_state_history h WHERE h.component_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1),'') AS revision FROM components c WHERE c.id=?`)
        .bind(id).first<{ revision: string }>())?.revision ?? null;
    },
    async groupRevision(id: string) {
      return (await db.prepare('SELECT updated_at AS revision FROM component_groups WHERE id=?').bind(id).first<{ revision: string }>())?.revision ?? null;
    },
  };
}
