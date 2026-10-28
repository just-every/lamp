import type { Session } from '@runeditrun/rer/modules/operator-auth';
import { sessionAuthority } from '../../platform/auth/authority';

export async function nativeArgumentsHash(value: Record<string, unknown>) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)])) : value;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value))));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function freshNativeProof(session: Session, local: boolean) {
  // Native local sessions already passed the installation's dev-key gate.
  // A production installation never accepts that kind as email proof.
  if (session.kind === 'dev') return {sql: local ? '1' : '0', params: []};
  return {sql: `(EXISTS(SELECT 1 FROM oa_step_up_challenges proof
      WHERE proof.session_id=? AND proof.operator_version=? AND proof.consumed_at>=unixepoch('subsec')*1000-600000)
    OR EXISTS(SELECT 1 FROM oa_sessions proof_session JOIN oa_tokens link ON link.id=proof_session.source_token_id
      WHERE proof_session.id=? AND proof_session.kind='native' AND proof_session.created_at>=unixepoch('subsec')*1000-600000))`,
    params: [session.id, session.operator.version, session.id]};
}

export function createNativeProofRepository(db: D1Database) {
  const authorityFor = async (input: {reference: string; personId: string; agentId: string; tool: string; argumentsHash: string; local: boolean}) => {
    const saved = await db.prepare(`SELECT native_session_json AS sessionJson FROM lamp_agent_native_proofs
      WHERE id=? AND operator_id=? AND agent_id=? AND tool=? AND arguments_sha256=? AND expires_at>unixepoch('subsec')*1000`)
      .bind(input.reference, input.personId, input.agentId, input.tool, input.argumentsHash).first<{sessionJson: string}>();
    if (!saved) return null;
    let session: Session;
    try { session = JSON.parse(saved.sessionJson) as Session; } catch { return null; }
    if (session.operator.id !== input.personId) return null;
    const authority = sessionAuthority(session), fresh = freshNativeProof(session, input.local);
    return {sql: `${authority.sql} AND ${fresh.sql}
      AND EXISTS(SELECT 1 FROM lamp_agent_native_proofs WHERE id=? AND operator_id=? AND agent_id=? AND tool=? AND arguments_sha256=? AND expires_at>unixepoch('subsec')*1000)`,
      params: [...authority.params, ...fresh.params, input.reference, input.personId, input.agentId, input.tool, input.argumentsHash]};
  };
  return {
    authority: authorityFor,
    async create(input: {session: Session; agentId: string; tool: string; argumentsHash: string; local: boolean}) {
      const id = crypto.randomUUID(), now = Date.now(), expiresAt = Math.min(input.session.expiresAt, now + 600_000);
      const authority = sessionAuthority(input.session), fresh = freshNativeProof(input.session, input.local);
      const result = await db.prepare(`INSERT INTO lamp_agent_native_proofs(id,operator_id,agent_id,tool,arguments_sha256,native_session_json,created_at,expires_at)
        SELECT ?,?,?,?,?,?,?,? WHERE ${authority.sql} AND ${fresh.sql}`).bind(id, input.session.operator.id, input.agentId,
        input.tool, input.argumentsHash, JSON.stringify(input.session), now, expiresAt, ...authority.params, ...fresh.params).run();
      return result.meta.changes ? {reference: id, expiresAt: new Date(expiresAt).toISOString()} : null;
    },
    async verify(input: {reference: string; personId: string; agentId: string; tool: string; argumentsHash: string; local: boolean}) {
      const authority = await authorityFor(input);
      return Boolean(authority && await db.prepare(`SELECT 1 WHERE ${authority.sql}`).bind(...authority.params).first());
    },
  };
}
