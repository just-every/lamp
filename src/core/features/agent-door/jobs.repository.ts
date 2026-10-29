import type { CallResult, InvocationIdentity } from '../../../../modules/agent-door/types.ts';

export interface AgentInvocation { name: string; args: Record<string, unknown>; who: InvocationIdentity }

/** Private worker custody. Public HTTP never supplies these identities. */
export function createAgentJobsRepository(db: D1Database) {
  return {
    async retain(input: AgentInvocation) {
      const id = crypto.randomUUID();
      await db.prepare('INSERT INTO lamp_agent_jobs(id,input_json,created_at) VALUES(?,?,?)')
        .bind(id, JSON.stringify(input), new Date().toISOString()).run();
      return id;
    },
    async read(id: string): Promise<{ input: AgentInvocation; result: CallResult | null } | null> {
      const row = await db.prepare('SELECT input_json,result_json FROM lamp_agent_jobs WHERE id=?').bind(id)
        .first<{ input_json: string; result_json: string | null }>();
      return row ? { input: JSON.parse(row.input_json), result: row.result_json ? JSON.parse(row.result_json) : null } : null;
    },
    async complete(id: string, result: CallResult) {
      await db.prepare('UPDATE lamp_agent_jobs SET result_json=?,completed_at=? WHERE id=? AND result_json IS NULL')
        .bind(JSON.stringify(result), new Date().toISOString(), id).run();
    },
  };
}
