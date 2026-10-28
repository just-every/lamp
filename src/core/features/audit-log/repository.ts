import { createUlid, nowIso } from '../../shared/ids';
export interface AuditFilter { actorId?: string; action?: string; from?: string; until?: string }
export interface AuditEntry { id: string; entityType: string; entityId: string; action: string; actorId: string | null; actorName: string; reason: string | null; createdAt: string }

/** Read identities at display time so erasure never leaves a copied name behind. */
export function createAuditLogRepository(db: D1Database) {
  function query(filter: AuditFilter) {
    const conditions: string[] = [], values: string[] = [];
    for (const [key, column, comparison] of [["actorId", "a.operator_id", "="], ["action", "a.action", "="], ["from", "a.created_at", ">="], ["until", "a.created_at", "<"]] as const) {
      if (filter[key]) { conditions.push(`${column} ${comparison} ?`); values.push(filter[key]!); }
    }
    const sql = `SELECT a.id, a.entity_type AS entityType, a.entity_id AS entityId, a.action,
      a.operator_id AS actorId,
      CASE WHEN a.operator_id IS NULL THEN 'System'
        WHEN o.id IS NULL OR o.email = 'deleted-' || lower(o.id) || '@operator.invalid' THEN 'Erased operator · ' || a.operator_id
        WHEN json_valid(a.payload_json) AND json_extract(a.payload_json,'$.actor.agent.name') IS NOT NULL
          THEN json_extract(a.payload_json,'$.actor.agent.name') || ' for ' || o.display_name
        ELSE o.display_name END AS actorName,
      a.reason, a.created_at AS createdAt
      FROM audit_entries a LEFT JOIN oa_operators o ON o.id = a.operator_id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY a.created_at DESC, a.id DESC`;
    return { sql, values };
  }
  return {
    async chatDesk(operator: string, event: string, entity: string) {
      const at = nowIso();
      await db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'chat-desk',?,'chat-desk',?,?,?,?)").bind(createUlid(),entity,operator,JSON.stringify({event}),at,at).run();
    },
    async list(filter: AuditFilter, limit = 50, offset = 0) {
      const { sql, values } = query(filter);
      return (await db.prepare(`${sql} LIMIT ? OFFSET ?`).bind(...values, limit + 1, offset).all<AuditEntry>()).results;
    },
    async export(filter: AuditFilter) {
      const { sql, values } = query(filter);
      return (await db.prepare(sql).bind(...values).all<AuditEntry>()).results;
    },
    async options() {
      const [actions, actors] = await db.batch([
        db.prepare("SELECT DISTINCT action FROM audit_entries ORDER BY action"),
        db.prepare(`SELECT DISTINCT a.operator_id AS id,
          CASE WHEN o.id IS NULL OR o.email = 'deleted-' || lower(o.id) || '@operator.invalid' THEN 'Erased operator · ' || a.operator_id ELSE o.display_name END AS name
          FROM audit_entries a LEFT JOIN oa_operators o ON o.id = a.operator_id WHERE a.operator_id IS NOT NULL ORDER BY name, id`),
      ]);
      return { actions: (actions.results as Array<{ action: string }>).map(row => row.action), actors: actors.results as Array<{ id: string; name: string }> };
    },
  };
}
