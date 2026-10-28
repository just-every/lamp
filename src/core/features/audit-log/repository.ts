import { createUlid, nowIso } from '../../shared/ids';
export interface AuditFilter { actorId?: string; action?: string; from?: string; until?: string }
export interface AuditEntry { id: string; entityType: string; entityId: string; action: string; actorId: string | null; actorName: string; approvedBy: string | null; nativeReviewedBy: string | null; reason: string | null; createdAt: string }

/** Read identities at display time so erasure never leaves a copied name behind. */
export function createAuditLogRepository(db: D1Database) {
  function query(filter: AuditFilter) {
    const conditions: string[] = [], values: string[] = [];
    for (const [key, column, comparison] of [["actorId", "a.operator_id", "="], ["action", "a.action", "="], ["from", "a.created_at", ">="], ["until", "a.created_at", "<"]] as const) {
      if (filter[key]) { conditions.push(`${column} ${comparison} ?`); values.push(filter[key]!); }
    }
    const sql = `SELECT a.id, a.entity_type AS entityType, a.entity_id AS entityId, a.action,
      a.operator_id AS actorId,
      COALESCE(p.agent_name || ' for ', '') || CASE WHEN a.operator_id IS NULL THEN 'System'
        WHEN o.id IS NULL OR o.email = 'deleted-' || lower(o.id) || '@operator.invalid' THEN 'Erased operator · ' || a.operator_id
        ELSE o.display_name END AS actorName,
      (SELECT group_concat(CASE WHEN approver.id IS NULL OR approver.email='deleted-' || lower(approver.id) || '@operator.invalid'
        THEN 'Erased operator · ' || json_extract(selected.value,'$.id') ELSE approver.display_name END, ', ')
        FROM json_each(COALESCE(p.approvers_json,'[]')) selected
        LEFT JOIN oa_operators approver ON approver.id=json_extract(selected.value,'$.id')) AS approvedBy,
      CASE WHEN json_extract(a.payload_json,'$.nativeReviewer.id') IS NULL THEN NULL
        WHEN reviewer.id IS NULL OR reviewer.email='deleted-' || lower(reviewer.id) || '@operator.invalid'
        THEN 'Erased operator · ' || json_extract(a.payload_json,'$.nativeReviewer.id') ELSE reviewer.display_name END AS nativeReviewedBy,
      a.reason, a.created_at AS createdAt
      FROM audit_entries a LEFT JOIN oa_operators o ON o.id = a.operator_id
      LEFT JOIN oa_operators reviewer ON reviewer.id=json_extract(a.payload_json,'$.nativeReviewer.id')
      LEFT JOIN lamp_agent_attribution p ON p.entity_type=a.entity_type AND p.entity_id=a.entity_id
        AND p.operator_id=a.operator_id AND p.created_at=a.created_at
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
