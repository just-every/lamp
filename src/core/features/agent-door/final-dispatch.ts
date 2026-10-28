import { AsyncLocalStorage } from 'node:async_hooks';
import { ToolRefusal } from '../../../../modules/agent-door/index.ts';
import type { AgentDoor, ToolDefinition, ClassAndFacts } from '../../../../modules/agent-door/types.ts';
import { queuedAgentOperation, recordQueuedAgentOutcome } from './provenance.repository';
import { hashOpaqueToken } from '../../platform/security/opaque-tokens';

export interface NativeEffectDescription {
  eventId: string; recipient: string; content: string; revision: string;
  counterparty: 'known' | 'public';
  classes?: ClassAndFacts[];
  attempt?: number;
}
interface NativeEffectHandler {
  describe(id: string): Promise<NativeEffectDescription | null>;
  dispatch(id: string): Promise<void>;
}
const drivers = new WeakMap<D1Database, Map<string, NativeEffectHandler>>();
const doors = new WeakMap<D1Database, AgentDoor>();
const admitted = new AsyncLocalStorage<{ kind: string; id: string }>();
export class AgentDeliveryHeld extends Error {
  constructor(readonly code: string) { super(`Agent delivery held: ${code}.`); }
}

export function registerAgentEffectHandler(db: D1Database, kind: string, driver: NativeEffectHandler) {
  let current = drivers.get(db);
  if (!current) drivers.set(db, current = new Map());
  current.set(kind, driver);
}
export function setAgentEffectDoor(db: D1Database, door: AgentDoor) { doors.set(db, door); }
export function agentEffectAdmitted(kind: string, id: string) {
  const active = admitted.getStore();
  return active?.kind === kind && active.id === id;
}

/** Run before the native provider claim. A true result means a nested typed
 * invocation completed the effect. Held/refused work never falls through. */
export async function agentEffectHandled(db: D1Database, kind: string, id: string): Promise<boolean> {
  const active = admitted.getStore();
  if (active?.kind === kind && active.id === id) return false;
  const driver = drivers.get(db)?.get(kind);
  const description = await driver?.describe(id);
  if (!description) return false;
  const custody = await queuedAgentOperation(db, { kind: 'publication', id: description.eventId });
  if (!custody) return false;
  const door = doors.get(db);
  if (!door) throw new Error('Agent delivery admission is unavailable.');
  const outcome = await door.invoke('lamp.deliveries.dispatch', {
    kind, id, idempotency_key: `delivery/${await hashOpaqueToken(`${kind}/${id}/${description.attempt ?? 0}`)}`, expected_revision: description.revision,
  }, custody.principal);
  await recordQueuedAgentOutcome(db, { kind: 'publication', id: description.eventId }, outcome);
  if (outcome.outcome !== 'done') throw new AgentDeliveryHeld(outcome.code ?? outcome.outcome);
  return true;
}

async function effect(db: D1Database, args: Record<string, unknown>) {
  const kind = String(args.kind), id = String(args.id);
  const driver = drivers.get(db)?.get(kind);
  const description = await driver?.describe(id);
  if (!driver || !description) throw new ToolRefusal('not_found');
  return { kind, id, driver, description };
}

/** Final provider work re-enters company policy with current sponsorship,
 * consent and scopes. Drivers retain their real claim and uncertainty rules. */
export function createQueuedDispatchTool(db: D1Database): ToolDefinition {
  return {
    name: 'lamp.deliveries.dispatch', title: 'Dispatch one retained notification',
    description: 'Send one retained native email, webhook, chat, social or SMS notification. Rechecks originating consent and sponsor; preserves native provider uncertainty.',
    scope: 'deliveries:dispatch', readOnly: false, classes: ['external', 'live'], clauses: ['NOTIFY-001', 'NOTIFY-003', 'AGENT-008'],
    inputSchema: { type: 'object', additionalProperties: false, required: ['kind', 'id'], properties: {
      kind: { type: 'string', enum: ['delivery', 'channel', 'social', 'sms', 'responder'] }, id: { type: 'string', minLength: 1, maxLength: 400 },
    } }, outputSchema: { type: 'object', required: ['id', 'kind', 'admitted'], properties: {
      id: { type: 'string' }, kind: { type: 'string' }, admitted: { type: 'boolean' },
    } }, revisionType: 'string',
    async revision(args) { return (await effect(db, args)).description.revision; },
    async classify(args) { const { description } = await effect(db, args); return description.classes ?? [{ class: 'external', facts: { measure: 1, counterparty: description.counterparty } }]; },
    async summary(args) { const { id, description } = await effect(db, args); return {
      target: { id }, recipients: [description.recipient], items: [description.content],
    }; },
    async run(args, ctx) {
      const { kind, id, driver, description } = await effect(db, args);
      const custody = await queuedAgentOperation(db, { kind: 'publication', id: description.eventId });
      if (!custody || custody.principal.person.id !== ctx.person.id || custody.principal.agent.id !== ctx.agent.id
        || custody.principal.consent !== ctx.consent) throw new ToolRefusal('native_authority_changed');
      await admitted.run({ kind, id }, () => driver.dispatch(id));
      ctx.emit('delivery.admitted', `lamp://deliveries/${encodeURIComponent(id)}`, { kind, event: description.eventId });
      return { result: { id, kind, admitted: true } };
    },
  };
}
