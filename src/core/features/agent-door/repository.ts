import type { Guard, ManagedMember, Member } from '../../../base/modules/business-settings/types.ts';

/** Durable Business identities and queued agent work live with native accounts. */
export function createLampDoorRepository(db: D1Database) {
  return {
    async owner() {
      return db.prepare(`SELECT o.id,o.email,o.version FROM oa_bootstrap b JOIN oa_operators o ON o.id=b.claim_id
        WHERE o.role='owner' AND o.status='active'`).first<{ id: string; email: string; version: number }>();
    },
    async person(id: string) {
      return db.prepare("SELECT id,email,display_name AS name,role,status,version FROM oa_operators WHERE id=?")
        .bind(id).first<{ id: string; email: string; name: string; role: string; status: string; version: number }>();
    },
    async team(input: { members: Member[]; managed: ManagedMember[]; guard: Guard; ownerEmail: string }) {
      const owner = await this.owner();
      if (!owner || owner.email !== input.ownerEmail) throw new Error('Native installation owner changed');
      const rows: ManagedMember[] = [];
      const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO bs_assert(value)
        VALUES(CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND version=? AND role='owner' AND status='active') THEN 1 ELSE NULL END)`)
        .bind(owner.id, owner.email, owner.version)];
      const desired = new Map(input.members.map(member => [member.email, member]));
      for (const email of new Set([...desired.keys(), ...input.managed.map(row => row.email)])) {
        const member = desired.get(email), prior = input.managed.find(row => row.email === email);
        // Once applied, the native ID is immutable even when either email changes.
        const target = prior?.operatorId ? await this.person(prior.operatorId)
          : await db.prepare("SELECT id,email,display_name AS name,role,status,version FROM oa_operators WHERE email=?")
            .bind(email).first<{ id: string; email: string; name: string; role: string; status: string; version: number }>();
        const conflicted = !target || target.id === owner.id || target.role !== 'owner'
          || (prior?.businessId && member?.id && member.id !== prior.businessId);
        rows.push({ email, operatorId: prior?.operatorId ?? (conflicted ? null : target!.id),
          invite: member?.invite ?? prior?.invite ?? 0,
          state: conflicted ? 'conflict' : !member || target!.status === 'inactive' ? 'inactive'
            : target!.status === 'active' ? 'active' : 'invited' });
        if (!conflicted) statements.push(db.prepare(`INSERT INTO bs_assert(value)
          VALUES(CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role='owner') THEN 1 ELSE NULL END)`)
          .bind(target!.id, target!.version));
      }
      // Account invitation/removal still requires Lamp's recent-human-proof
      // lifecycle. Signed roster application never manufactures that proof.
      return { rows, statements, async afterCommit() {} };
    },
    async mapped(sub: string) {
      const owner = await db.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0 AND document IS NOT NULL').first<{ owner_id: string | null }>();
      if (owner?.owner_id === sub) return (await this.owner())?.id ?? null;
      if (!owner) return null;
      return (await db.prepare("SELECT operator_id AS id FROM bs_team WHERE business_id=? AND state='active'").bind(sub).first<{ id: string }>())?.id ?? null;
    },
    async member(id: string) {
      const settings = await db.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0 AND document IS NOT NULL').first<{ owner_id: string | null }>();
      if (!settings) return null;
      if ((await this.owner())?.id === id && settings.owner_id) return { id: settings.owner_id, role: 'owner' as const };
      const row = await db.prepare("SELECT business_id AS id,business_role AS role FROM bs_team WHERE operator_id=? AND state='active' AND business_id IS NOT NULL")
        .bind(id).first<{ id: string; role: string }>();
      return row ? { id: row.id, role: row.role === 'admin' ? 'editor' as const : null } : null;
    },
    async liveClient(id: string, sponsor: string) {
      id = id.startsWith('management-token:') ? id.slice('management-token:'.length) : id;
      return db.prepare(`SELECT t.id,t.name,t.read_scope AS readScope,t.scope,c.operator_version AS version,c.kind FROM management_tokens t
        JOIN oa_credentials c ON c.id=t.id JOIN oa_operators o ON o.id=c.operator_id
        WHERE t.id=? AND t.issuer_id=? AND c.operator_id=t.issuer_id AND o.status='active' AND o.role='owner'
        AND o.version=c.operator_version AND c.revoked_at IS NULL AND t.revoked_at IS NULL
        AND c.expires_at>unixepoch('subsec')*1000 AND t.expires_at>unixepoch('subsec')*1000`)
        .bind(id, sponsor).first<{ id: string; name: string; readScope: number; scope: string | null; version: number; kind: string }>();
    },
    async saveJob(input: { id: string; tool: string; args: unknown; dueAt: string; principal: unknown }) {
      await db.prepare("INSERT INTO lamp_agent_jobs(id,tool,args_json,due_at,principal_json,state,created_at) VALUES(?,?,?,?,?,'pending',?)")
        .bind(input.id, input.tool, JSON.stringify(input.args), input.dueAt, JSON.stringify(input.principal), new Date().toISOString()).run();
    },
    async dueJobs(now: string) {
      return (await db.prepare("SELECT id,tool,args_json AS args,principal_json AS principal FROM lamp_agent_jobs WHERE state='pending' AND due_at<=? ORDER BY due_at,id LIMIT 25")
        .bind(now).all<{ id: string; tool: string; args: string; principal: string }>()).results;
    },
    async finishJob(id: string, result: unknown, state: 'done' | 'pending' | 'refused') {
      await db.prepare('UPDATE lamp_agent_jobs SET state=?,result_json=?,updated_at=? WHERE id=?')
        .bind(state, JSON.stringify(result), new Date().toISOString(), id).run();
    },
    async recordAction(input: { id: string; tool: string; target: string | null; person: string; actor: unknown; result: unknown }) {
      const now = new Date().toISOString();
      await db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
        VALUES(?,'agent-operation',?,?,?,?,?,?)`).bind(input.id, input.target ?? input.id, input.tool, input.person,
        JSON.stringify({ actor: input.actor, result: input.result }), now, now).run();
    },
  };
}
