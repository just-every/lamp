import { ToolRefusal, type ToolContext } from '../../../base/modules/agent-door/index.ts';
import type { AgentAction } from '../incidents/agent-action';

/** A final worker verb cannot transfer a retained operation to another principal. */
export function assertAgentCustody(action:AgentAction|null,ctx:ToolContext) {
  if(!action?.invocation || action.sponsor.id!==ctx.person.id || action.agent.id!==ctx.agent.id
    || action.invocation.consent!==ctx.consent || action.invocation.clientId!==ctx.clientId
    || !action.invocation.scopes.includes('lamp:publish'))throw new ToolRefusal('native_agent_custody_unavailable');
}
