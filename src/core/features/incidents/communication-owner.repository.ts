import { createUlid, nowIso } from "../../shared/ids";

export interface CommunicationOwner { id: string; displayName: string }
export interface CommunicationOwnership { owner: CommunicationOwner | null; unowned: boolean }

/** Operator-only identity projection. Never use it to build public artifacts. */
export function createCommunicationOwnerRepository(db: D1Database) {
  const ownerJoin = `LEFT JOIN incident_communication_owners assignment ON assignment.incident_id=i.id
    LEFT JOIN oa_operators person ON person.id=COALESCE(assignment.operator_id,i.created_by_operator_id) AND person.status='active'`;
  return {
    async list(): Promise<Map<string, CommunicationOwnership>> {
      const rows = (await db.prepare(`SELECT i.id, i.lifecycle,person.id AS ownerId,person.display_name AS displayName FROM incidents i ${ownerJoin} WHERE i.deleted_at IS NULL`).all<{ id: string; lifecycle: string; ownerId: string | null; displayName: string | null }>()).results;
      return new Map(rows.map(row => [row.id, { owner: row.ownerId ? { id: row.ownerId, displayName: row.displayName! } : null, unowned: row.lifecycle !== 'Resolved' && !row.ownerId }]));
    },
    async get(incidentId: string): Promise<CommunicationOwnership> {
      const row = await db.prepare(`SELECT i.lifecycle,person.id AS ownerId,person.display_name AS displayName FROM incidents i ${ownerJoin} WHERE i.id=? AND i.deleted_at IS NULL`).bind(incidentId).first<{ lifecycle: string; ownerId: string | null; displayName: string | null }>();
      return { owner: row?.ownerId ? { id: row.ownerId, displayName: row.displayName! } : null, unowned: Boolean(row && row.lifecycle !== 'Resolved' && !row.ownerId) };
    },
    async recipients(incidentId: string): Promise<string[] | undefined> {
      const row = await db.prepare(`SELECT person.email FROM incidents i ${ownerJoin} WHERE i.id=? AND i.deleted_at IS NULL`).bind(incidentId).first<{ email: string | null }>();
      return row?.email ? [row.email] : undefined;
    },
    async activeOperators(): Promise<CommunicationOwner[]> {
      return (await db.prepare(`SELECT id,display_name AS displayName FROM oa_operators WHERE status='active' ORDER BY display_name,id`).all<CommunicationOwner>()).results;
    },
    async assign(incidentId: string, operatorId: string, actorId: string): Promise<"ok" | "missing" | "resolved" | "inactive"> {
      const at = nowIso();
      const allowed = `i.id=? AND i.deleted_at IS NULL AND i.lifecycle<>'Resolved' AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active') AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')`;
      const params = [incidentId,operatorId,actorId];
      const [, mutation] = await db.batch([
        db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
          SELECT ?,'incident',i.id,'communication-owner-changed',?,json_object('from',COALESCE(assignment.operator_id,i.created_by_operator_id),'to',?),?,?
          FROM incidents i LEFT JOIN incident_communication_owners assignment ON assignment.incident_id=i.id
          WHERE ${allowed} AND COALESCE(assignment.operator_id,i.created_by_operator_id)<>?`).bind(createUlid(),actorId,operatorId,at,at,...params,operatorId),
        db.prepare(`INSERT INTO incident_communication_owners(incident_id,operator_id,updated_at)
          SELECT i.id,?,? FROM incidents i WHERE ${allowed}
          ON CONFLICT(incident_id) DO UPDATE SET operator_id=excluded.operator_id,updated_at=excluded.updated_at RETURNING incident_id`).bind(operatorId,at,...params),
      ]);
      if (mutation.results.length) return "ok";
      const incident = await db.prepare(`SELECT lifecycle FROM incidents WHERE id=? AND deleted_at IS NULL`).bind(incidentId).first<{ lifecycle: string }>();
      return !incident ? "missing" : incident.lifecycle === "Resolved" ? "resolved" : "inactive";
    },
  };
}
