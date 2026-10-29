import type { AgentDoor, CallResult } from '../../../../modules/agent-door/types.ts';
import { currentAgentActor, type NativeAgentActor } from './actor';

export const agentProvenanceSchema = `
CREATE TABLE lamp_agent_attribution (
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operator_id TEXT NOT NULL,
  agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, approvers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id, created_at)
);
CREATE INDEX lamp_agent_attribution_entity ON lamp_agent_attribution(entity_type, entity_id, created_at DESC);
CREATE TABLE lamp_agent_queued_operations (
  kind TEXT NOT NULL, id TEXT NOT NULL, tool TEXT NOT NULL, args_json TEXT NOT NULL,
  principal_json TEXT NOT NULL, created_at TEXT NOT NULL, last_outcome_json TEXT,
  PRIMARY KEY(kind,id)
);`;

/** Include these statements in the same native batch as the corresponding
 * record/activity change. A failed native transaction leaves no attribution. */
export function agentAttributionStatements(db: D1Database, input: {
  entityType: string; entityId: string; operatorId: string; at: string;
  exists?: { sql: string; params?: unknown[] };
  guard?: { sql: string; params?: unknown[] };
  publication?: boolean;
}): D1PreparedStatement[] {
  const publication = input.publication ?? ['incident-update', 'maintenance-notice', 'component-state', 'component-state-history'].includes(input.entityType);
  const actor = currentAgentActor();
  if (!actor) return publication ? agentQueuedOperationStatements(db, {
    kind: 'publication', id: input.entityId, tool: 'lamp.deliveries.dispatch',
    args: { event_id: input.entityId, idempotency_key: `publication/${input.entityId}` }, at: input.at, guard: input.exists ?? input.guard,
  }) : [];
  if (actor.sponsor.id !== input.operatorId) throw new Error('Agent sponsor does not match native operator.');
  const guard = input.exists ?? input.guard;
  const attribution = db.prepare(`INSERT INTO lamp_agent_attribution
    (entity_type,entity_id,operator_id,agent_id,agent_name,approvers_json,created_at)
    SELECT ?,?,?,?,?,?,?${guard ? ` WHERE ${guard.sql}` : ''} ON CONFLICT(entity_type,entity_id,created_at) DO NOTHING`)
    .bind(input.entityType, input.entityId, input.operatorId, actor.agent.id, actor.agent.name,
      JSON.stringify(actor.approvers.map(person => ({ id: person.id }))), input.at, ...(guard?.params ?? []));
  return [attribution, ...(publication ? agentQueuedOperationStatements(db, {
    kind: 'publication', id: input.entityId, tool: 'lamp.deliveries.dispatch',
    args: { event_id: input.entityId, idempotency_key: `publication/${input.entityId}` }, at: input.at, guard,
  }) : [])];
}

export interface NativeAttribution {
  agent: { id: string; name: string };
  sponsor: { id: string; name: string };
  approvers: Array<{ id: string; name: string }>;
  label: string;
}

/** Current native names preserve erasure and cannot move the stable binding. */
export async function nativeAgentAttribution(db: D1Database, entityType: string, entityId: string, at?: string): Promise<NativeAttribution | null> {
  const row = await db.prepare(`SELECT p.agent_id AS agentId,p.agent_name AS agentName,p.operator_id AS sponsorId,
    p.approvers_json AS approversJson,
    CASE WHEN o.id IS NULL OR o.email='deleted-' || lower(o.id) || '@operator.invalid'
      THEN 'Erased operator · ' || p.operator_id ELSE o.display_name END AS sponsorName
    FROM lamp_agent_attribution p LEFT JOIN oa_operators o ON o.id=p.operator_id
    WHERE p.entity_type=? AND p.entity_id=? AND (? IS NULL OR p.created_at=?) ORDER BY p.created_at DESC LIMIT 1`)
    .bind(entityType, entityId, at??null, at??null).first<{ agentId: string; agentName: string; sponsorId: string; sponsorName: string; approversJson: string }>();
  if (!row) return null;
  const approvers: NativeAttribution['approvers'] = [];
  for (const person of JSON.parse(row.approversJson) as Array<{ id: string }>) {
    const current = await db.prepare(`SELECT CASE WHEN email='deleted-' || lower(id) || '@operator.invalid'
      THEN 'Erased operator · ' || id ELSE display_name END AS name FROM oa_operators WHERE id=?`)
      .bind(person.id).first<{ name: string }>();
    approvers.push({ id: person.id, name: current?.name ?? `Erased operator · ${person.id}` });
  }
  return { agent: { id: row.agentId, name: row.agentName }, sponsor: { id: row.sponsorId, name: row.sponsorName },
    approvers, label: `${row.agentName} for ${row.sponsorName}` };
}

export interface QueuedAgentOperation {
  tool: string; args: Record<string, unknown>;
  principal: Pick<NativeAgentActor, 'agent' | 'scopes' | 'consent' | 'clientId'> & { person: { id: string }; operationId?: string };
}

/** Native schedule edits by a person supersede old machine custody. The final
 * operation is a distinct typed action, with its own exact idempotency key. */
export function agentQueuedOperationStatements(db: D1Database, input: {
  kind: string; id: string; tool: string; args: Record<string, unknown>; at: string;
  exists?: { sql: string; params?: unknown[] };
  guard?: { sql: string; params?: unknown[] };
}): D1PreparedStatement[] {
  const actor = currentAgentActor();
  const guard = input.exists ?? input.guard;
  if (!actor) return [db.prepare(`DELETE FROM lamp_agent_queued_operations WHERE kind=? AND id=?${guard ? ` AND ${guard.sql}` : ''}`)
    .bind(input.kind, input.id, ...(guard?.params ?? []))];
  if (typeof input.args.idempotency_key !== 'string' || !input.args.idempotency_key) throw new Error('A queued agent effect requires its exact idempotency key.');
  const principal: QueuedAgentOperation['principal'] = { person: { id: actor.sponsor.id }, agent: actor.agent,
    scopes: actor.scopes, consent: actor.consent, clientId: actor.clientId,
    ...(input.kind === 'publication' ? { operationId: actor.operationId } : {}) };
  const args = input.kind === 'publication' ? { ...input.args, idempotency_key: actor.idempotencyKey } : input.args;
  if (typeof args.idempotency_key !== 'string' || !args.idempotency_key) throw new Error('A queued publication requires its originating admission key.');
  return [db.prepare(`INSERT INTO lamp_agent_queued_operations(kind,id,tool,args_json,principal_json,created_at)
    SELECT ?,?,?,?,?,?${guard ? ` WHERE ${guard.sql}` : ''} ON CONFLICT(kind,id) DO UPDATE SET tool=excluded.tool,args_json=excluded.args_json,
    principal_json=excluded.principal_json,created_at=excluded.created_at,last_outcome_json=NULL`)
    .bind(input.kind, input.id, input.tool, JSON.stringify(args), JSON.stringify(principal), input.at, ...(guard?.params ?? []))];
}

export async function queuedAgentOperation(db: D1Database, input: { kind: string; id: string }): Promise<QueuedAgentOperation | null> {
  const row = await db.prepare('SELECT tool,args_json AS argsJson,principal_json AS principalJson FROM lamp_agent_queued_operations WHERE kind=? AND id=?')
    .bind(input.kind, input.id).first<{ tool: string; argsJson: string; principalJson: string }>();
  return row ? { tool: row.tool, args: JSON.parse(row.argsJson), principal: JSON.parse(row.principalJson) } : null;
}

export async function recordQueuedAgentOutcome(db: D1Database, input: { kind: string; id: string }, outcome: CallResult) {
  await db.prepare('UPDATE lamp_agent_queued_operations SET last_outcome_json=? WHERE kind=? AND id=?')
    .bind(JSON.stringify(outcome), input.kind, input.id).run();
}

/** A non-null result means an agent job was handled. In particular, pending or
 * refused work must never fall through to the native person's execution path. */
export async function invokeQueuedAgentOperation(db: D1Database, door: AgentDoor, input: { kind: string; id: string; cycle?: string }): Promise<CallResult | null> {
  const operation = await queuedAgentOperation(db, input);
  if (!operation) return null;
  const args = input.cycle === undefined ? operation.args : {
    ...operation.args, idempotency_key: `${operation.args.idempotency_key}/${input.cycle}`,
  };
  const outcome = await door.invoke(operation.tool, args, operation.principal);
  await recordQueuedAgentOutcome(db, input, outcome);
  return outcome;
}
