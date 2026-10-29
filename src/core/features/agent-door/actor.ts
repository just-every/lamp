import { AsyncLocalStorage } from 'node:async_hooks';
import type { Agent, ToolContext } from '../../../../modules/agent-door/types.ts';

/** Native services keep the sponsor's real operator foreign key. This context
 * carries the machine preparer separately; it is never an operator session. */
export interface NativeAgentActor {
  agent: Agent;
  sponsor: { id: string; name: string };
  approvers: Array<{ id: string; name: string }>;
  scopes: string[];
  consent?: string;
  clientId?: string;
  operationId: string;
  idempotencyKey: string | null;
  label: string;
}

const actors = new AsyncLocalStorage<NativeAgentActor>();

export function currentAgentActor(): NativeAgentActor | null {
  return actors.getStore() ?? null;
}

export function withAgentActor<T>(ctx: ToolContext, action: () => T): T {
  return actors.run({
    agent: { ...ctx.agent }, sponsor: { id: ctx.person.id, name: ctx.person.name },
    approvers: ctx.approvers.map(person => ({ ...person })), scopes: [...ctx.scopes],
    consent: ctx.consent, clientId: ctx.clientId, label: ctx.actor.label,
    operationId: ctx.operationId, idempotencyKey: ctx.idempotencyKey,
  }, action);
}
