import type { AgentDoor, ToolContext } from '../../../base/modules/agent-door/index.ts';
import { createLampDoorRepository } from './repository';

/** Worker admission keeps the original person ID, agent, consent and scopes. */
export async function scheduleAgentJob(ctx: ToolContext, input: { tool: string; args: Record<string, unknown>; dueAt: string; expectedRevision?: string | number }) {
  const instant = new Date(input.dueAt);
  if (!Number.isFinite(instant.getTime())) throw new Error('Schedule must name a valid instant');
  const id = crypto.randomUUID();
  await createLampDoorRepository(ctx.db).saveJob({ id, tool: input.tool, dueAt: instant.toISOString(),
    args: { ...input.args, idempotency_key: `scheduled:${id}`, ...(input.expectedRevision !== undefined ? { expected_revision: input.expectedRevision } : {}) },
    principal: { person: { id: ctx.person.id }, agent: ctx.agent, consent: ctx.consent, scopes: ctx.scopes, clientId: ctx.clientId } });
  return { id, dueAt: instant.toISOString(), state: 'pending' as const };
}

export async function runAgentJobs(db: D1Database, door: AgentDoor, now = new Date().toISOString()) {
  const repository = createLampDoorRepository(db);
  for (const job of await repository.dueJobs(now)) {
    // Concurrent workers share the door's durable idempotency key. A transport
    // uncertainty never causes a new operation identity or a blind resend.
    const result = await door.invoke(job.tool, JSON.parse(job.args), JSON.parse(job.principal));
    await repository.finishJob(job.id, result, result.outcome);
  }
}
