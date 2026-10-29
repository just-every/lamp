import type { Agent } from '../../../../modules/agent-door/types.ts';

/** Business OAuth client ids are not mutable native management credentials. */
export function managementClientId(principal: {clientId?: string; agent: Agent}): string | null {
  return principal.clientId && principal.agent.id === `management:${principal.clientId}` ? principal.clientId : null;
}
