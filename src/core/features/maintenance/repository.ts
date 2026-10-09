import { asc, eq } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { allocateReference, type AllocatedReference } from "../../shared/references/repository";
import { createUlid } from "../../shared/ids";
import { maintenance, maintenanceComponents } from "../../shared/schema";

export type StoredMaintenance = typeof maintenance.$inferSelect;
export type StoredMaintenanceComponent = typeof maintenanceComponents.$inferSelect;
export interface MaintenanceNotice { id: string; maintenanceId: string; kind: "scheduled" | "rescheduled" | "reminder" | "started" | "completed" | "cancelled"; body: string; publishedAt: string; authorOperatorId: string | null; createdAt: string; updatedAt: string; }

export interface MaintenanceRepository {
  allocateMaintenanceReference(): Promise<AllocatedReference>;
  listMaintenance(): Promise<StoredMaintenance[]>;
  listComponents(maintenanceId: string): Promise<StoredMaintenanceComponent[]>;
  find(maintenanceId: string): Promise<StoredMaintenance | null>;
  create(input: typeof maintenance.$inferInsert, components: Array<typeof maintenanceComponents.$inferInsert>, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<void>;
  updateWindowWithNotice(maintenanceId: string, startsAt: string, endsAt: string, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  transitionWithNotice(maintenanceId: string, from: "Scheduled" | "In progress", to: "In progress" | "Completed", completedAt: string | null, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  cancelWithNotice(maintenanceId: string, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  listDue(now: string): Promise<StoredMaintenance[]>;
  listReminderDue(now: string): Promise<StoredMaintenance[]>;
  writeNotice(input: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  listNotices(maintenanceId: string): Promise<MaintenanceNotice[]>;
}

export function createMaintenanceRepository(binding: D1Database): MaintenanceRepository {
  const database = createDatabase(binding);
  const noticeStatement = (notice: MaintenanceNotice) => binding.prepare(`INSERT INTO maintenance_notices (id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(notice.id, notice.maintenanceId, notice.kind, notice.body, notice.publishedAt, notice.authorOperatorId, notice.createdAt, notice.updatedAt);
  const writeMutationWithNotice = async (mutation: D1PreparedStatement, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]) => {
    const auditId = createUlid();
    const guard = binding.prepare(`INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, reason, payload_json, created_at, updated_at)
      SELECT ?, 'maintenance', ?, 'notice-published', ?, NULL, '{}', ?, ?
      WHERE changes() = 1`)
      .bind(auditId, notice.maintenanceId, notice.authorOperatorId, notice.createdAt, notice.updatedAt);
    const guardedNotice = binding.prepare(`INSERT INTO maintenance_notices (id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM audit_entries WHERE id = ?)`)
      .bind(notice.id, notice.maintenanceId, notice.kind, notice.body, notice.publishedAt, notice.authorOperatorId, notice.createdAt, notice.updatedAt, auditId);
    const results = await binding.batch([
      mutation,
      guard,
      guardedNotice,
      ...notificationStatements,
    ]);
    return results[1]?.meta.changes === 1;
  };

  return {
    async allocateMaintenanceReference() { return allocateReference(binding, "SCH"); },
    async listMaintenance() {
      return database.select().from(maintenance).orderBy(asc(maintenance.startsAt)).all();
    },
    async listComponents(maintenanceId) {
      return database.select().from(maintenanceComponents).where(eq(maintenanceComponents.maintenanceId, maintenanceId)).all();
    },
    async find(maintenanceId) {
      const item = await database.select().from(maintenance).where(eq(maintenance.id, maintenanceId)).get();
      return item ?? null;
    },
    async create(input, attached, notice, notificationStatements) {
      await binding.batch([
        binding.prepare(`INSERT INTO maintenance (id,reference,title,state,starts_at,ends_at,completed_at,created_by_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(input.id, input.reference, input.title, input.state, input.startsAt, input.endsAt, input.completedAt, input.createdByOperatorId, input.createdAt, input.updatedAt),
        ...attached.map((component) => binding.prepare(`INSERT INTO maintenance_components (id,maintenance_id,component_id,component_name,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(component.id, component.maintenanceId, component.componentId, component.componentName, component.state, component.createdAt, component.updatedAt)),
        binding.prepare(`INSERT INTO maintenance_notices (id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(notice.id, notice.maintenanceId, notice.kind, notice.body, notice.publishedAt, notice.authorOperatorId, notice.createdAt, notice.updatedAt),
        ...notificationStatements,
      ]);
    },
    async updateWindowWithNotice(maintenanceId, startsAt, endsAt, updatedAt, notice, notificationStatements) {
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ? AND state = 'Scheduled'`).bind(startsAt, endsAt, updatedAt, maintenanceId),
        notice,
        notificationStatements,
      );
    },
    async transitionWithNotice(maintenanceId, from, to, completedAt, updatedAt, notice, notificationStatements) {
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET state = ?, completed_at = ?, updated_at = ? WHERE id = ? AND state = ?`).bind(to, completedAt, updatedAt, maintenanceId, from),
        notice,
        notificationStatements,
      );
    },
    async cancelWithNotice(maintenanceId, updatedAt, notice, notificationStatements) {
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET state = 'Cancelled', updated_at = ? WHERE id = ? AND state = 'Scheduled'`).bind(updatedAt, maintenanceId),
        notice,
        notificationStatements,
      );
    },
    async listDue(now) {
      const result = await binding.prepare(`SELECT id, reference, title, state, starts_at AS startsAt, ends_at AS endsAt, completed_at AS completedAt, created_by_operator_id AS createdByOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM maintenance WHERE (state = 'Scheduled' AND starts_at <= ?) OR (state = 'In progress' AND ends_at <= ?)`).bind(now, now).all<StoredMaintenance>();
      return result.results;
    },
    async listReminderDue(now) {
      const result = await binding.prepare(`SELECT maintenance.id, maintenance.reference, maintenance.title, maintenance.state, maintenance.starts_at AS startsAt, maintenance.ends_at AS endsAt, maintenance.completed_at AS completedAt, maintenance.created_by_operator_id AS createdByOperatorId, maintenance.created_at AS createdAt, maintenance.updated_at AS updatedAt FROM maintenance LEFT JOIN maintenance_notices ON maintenance_notices.maintenance_id = maintenance.id AND maintenance_notices.kind = 'reminder' WHERE maintenance.state = 'Scheduled' AND maintenance.starts_at <= ? AND maintenance.starts_at > ? AND maintenance_notices.id IS NULL`).bind(new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString(), now).all<StoredMaintenance>();
      return result.results;
    },
    async writeNotice(input, notificationStatements) {
      await binding.batch([
        noticeStatement(input),
        ...notificationStatements,
      ]);
      return true;
    },
    async listNotices(maintenanceId) {
      const result = await binding.prepare(`SELECT id, maintenance_id AS maintenanceId, kind, body, published_at AS publishedAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM maintenance_notices WHERE maintenance_id = ? ORDER BY published_at DESC`).bind(maintenanceId).all<MaintenanceNotice>();
      return result.results;
    },
  };
}
