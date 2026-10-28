import type { ToolContext } from '../../../base/modules/agent-door/types.ts';

/** Immutable attribution for the native action. The operator relation remains the sponsor. */
export interface AgentAction {
  agent: { id: string; name: string };
  sponsor: { id: string; name: string };
  label: string;
  approvers: Array<{ id: string; name: string }>;
  invocation?: { consent?: string; scopes: string[]; clientId?: string };
}

export function agentAction(ctx: ToolContext): AgentAction {
  return {
    agent: { id: ctx.agent.id, name: ctx.agent.name },
    sponsor: { id: ctx.person.id, name: ctx.person.name },
    label: ctx.actor.label,
    approvers: ctx.approvers.map(person => ({ id: person.id, name: person.name })),
    invocation: { consent: ctx.consent, scopes: [...ctx.scopes], clientId: ctx.clientId },
  };
}

export function parseAgentAction(value: string | null | undefined): AgentAction | null {
  if (!value) return null;
  const action = JSON.parse(value) as AgentAction;
  if (typeof action.label !== 'string' || !action.agent?.id || !action.sponsor?.id || !Array.isArray(action.approvers)) throw new Error('Stored agent attribution is invalid.');
  return action;
}

export type PublicAgentAction = { label: string; approvers: Array<{ name: string }> };

export function publicAgentAction(action: AgentAction | null | undefined): PublicAgentAction | undefined {
  return action ? { label: action.label, approvers: action.approvers.map(person => ({ name: person.name })) } : undefined;
}

export function agentActionLines(action: PublicAgentAction | null | undefined): string[] {
  return action ? [
    `Prepared by: ${action.label}`,
    ...(action.approvers.length ? [`Approved by: ${action.approvers.map(person => person.name).join(', ')}`] : []),
  ] : [];
}
