import { asc, eq, sql } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { allocateReference, type AllocatedReference } from "../../shared/references/repository";
import { createUlid } from "../../shared/ids";
import { maintenance, maintenanceComponents } from "../../shared/schema";

export type StoredMaintenance = typeof maintenance.$inferSelect;
export type StoredMaintenanceComponent = typeof maintenanceComponents.$inferSelect;
export interface MaintenanceNotice { snapshotJson?: string | null; correctsNoticeId?: string | null; id: string; maintenanceId: string; kind: "scheduled" | "rescheduled" | "reminder" | "started" | "completed" | "cancelled" | "verifying" | "update"; body: string; publishedAt: string; authorOperatorId: string | null; createdAt: string; updatedAt: string; }

export interface ImportedMaintenanceUpdate { id: string; body: string; publishedAt: string; sourceStates: string; sourceStatus?: string | null }

export interface MaintenanceCollectionDetails {
  components: StoredMaintenanceComponent[];
  notices: MaintenanceNotice[];
  importedUpdates: Array<ImportedMaintenanceUpdate & { maintenanceId: string }>;
}

export interface MaintenanceRepository {
  publishUpdate(record: StoredMaintenance, previous: StoredMaintenance, notice: MaintenanceNotice, statements: D1PreparedStatement[], draft?: import("./drafts").DraftReference): Promise<boolean>;
  listCollectionDetails(): Promise<MaintenanceCollectionDetails>;
  listImportedUpdates(maintenanceId: string): Promise<ImportedMaintenanceUpdate[]>;
  allocateMaintenanceReference(): Promise<AllocatedReference>;
  listMaintenance(): Promise<StoredMaintenance[]>;
  listComponents(maintenanceId: string): Promise<StoredMaintenanceComponent[]>;
  find(maintenanceId: string): Promise<StoredMaintenance | null>;
  create(input: typeof maintenance.$inferInsert, components: Array<typeof maintenanceComponents.$inferInsert>, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[], draft?: import("./drafts").DraftReference): Promise<void>;
  updateWindowWithNotice(maintenanceId: string, startsAt: string, endsAt: string, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  extendInProgressWithNotice(maintenanceId: string, startsAt: string, previousEndsAt: string, endsAt: string, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  transitionWithNotice(maintenanceId: string, from: "Scheduled" | "In progress", to: "In progress" | "Completed", completedAt: string | null, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[], expectedWindow?: Pick<StoredMaintenance, "startsAt" | "endsAt">): Promise<boolean>;
  cancelWithNotice(maintenanceId: string, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  listDue(now: string): Promise<StoredMaintenance[]>;
  listReminderDue(now: string): Promise<StoredMaintenance[]>;
  writeNotice(input: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  listNotices(maintenanceId: string): Promise<MaintenanceNotice[]>;
}

export function createMaintenanceRepository(binding: D1Database): MaintenanceRepository {
  const database = createDatabase(binding);
  const storedKind = (notice: MaintenanceNotice) => notice.kind === "verifying" || notice.kind === "update" ? "rescheduled" : notice.kind;
  const noticeValues = (notice: MaintenanceNotice) => [notice.id, notice.maintenanceId, storedKind(notice), notice.body, notice.publishedAt, notice.authorOperatorId, notice.createdAt, notice.updatedAt, notice.snapshotJson ?? null, notice.kind, notice.correctsNoticeId ?? null];
  const noticeColumns = "id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at,snapshot_json,notice_kind,corrects_notice_id";
  const noticeStatement = (notice: MaintenanceNotice) => binding.prepare(`INSERT OR IGNORE INTO maintenance_notices (${noticeColumns}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(...noticeValues(notice));
  const writeMutationWithNotice = async (mutation: D1PreparedStatement, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]) => {
    const auditId = createUlid();
    const guard = binding.prepare(`INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, reason, payload_json, created_at, updated_at)
      SELECT ?, 'maintenance', ?, 'notice-published', ?, NULL, '{}', ?, ?
      WHERE changes() = 1`)
      .bind(auditId, notice.maintenanceId, notice.authorOperatorId, notice.createdAt, notice.updatedAt);
    const guardedNotice = binding.prepare(`INSERT INTO maintenance_notices (${noticeColumns}) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM audit_entries WHERE id = ?)`)
      .bind(...noticeValues(notice), auditId);
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
    async listCollectionDetails() {
      const [components, notices, importedUpdates] = await Promise.all([
        database.select().from(maintenanceComponents).orderBy(maintenanceComponents.maintenanceId).all(),
        binding.prepare(`SELECT id, maintenance_id AS maintenanceId, COALESCE(notice_kind,kind) AS kind, snapshot_json AS snapshotJson, corrects_notice_id AS correctsNoticeId, body, published_at AS publishedAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM maintenance_notices ORDER BY maintenance_id, published_at DESC`).all<MaintenanceNotice>(),
        binding.prepare(`SELECT id, maintenance_id AS maintenanceId, body, published_at AS publishedAt, source_states AS sourceStates,source_status AS sourceStatus FROM import_maintenance_updates ORDER BY maintenance_id, published_at DESC, id`).all<ImportedMaintenanceUpdate & { maintenanceId: string }>(),
      ]);
      return { components, notices: notices.results, importedUpdates: importedUpdates.results };
    },
    async listComponents(maintenanceId) {
      return database.select().from(maintenanceComponents).where(eq(maintenanceComponents.maintenanceId, maintenanceId)).all();
    },
    async find(maintenanceId) {
      const item = await database.select().from(maintenance).where(eq(maintenance.id, maintenanceId)).get();
      return item ?? null;
    },
    async create(input, attached, notice, notificationStatements, draft) {
      const record = input;
      const columns = ["id","reference","title","state","starts_at","ends_at","completed_at","created_by_operator_id","created_at","updated_at","affected_audience","customer_impact","what_still_works","details","wording_required","verifying","auto_start","auto_complete","remind_prior","calendar_sequence"];
      const values = [record.id,record.reference,record.title,record.state,record.startsAt,record.endsAt,record.completedAt,record.createdByOperatorId,record.createdAt,record.updatedAt,record.affectedAudience??"",record.customerImpact??"",record.whatStillWorks??"",record.details??"",Number(record.wordingRequired??false),0,Number(record.autoStart??true),Number(record.autoComplete??true),Number(record.remindPrior??true),0];
      await binding.batch([
        binding.prepare(`INSERT INTO maintenance (${columns.join(",")}) SELECT ${columns.map(()=>"?").join(",")} ${draft?.draftId ? "WHERE EXISTS (SELECT 1 FROM maintenance_drafts WHERE id=? AND version=?)" : ""}`).bind(...values,...(draft?.draftId?[draft.draftId,draft.draftVersion!]:[])),
        ...attached.map(component => binding.prepare(`INSERT INTO maintenance_components (id,maintenance_id,component_id,component_name,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(component.id,component.maintenanceId,component.componentId,component.componentName,component.state,component.createdAt,component.updatedAt)),
        noticeStatement(notice), ...notificationStatements,
        ...(draft?.draftId ? [binding.prepare("UPDATE maintenance_drafts SET version=version+1,payload_json=json_set(payload_json,'$.title','','$.startsAt','','$.endsAt','','$.componentIds',json('[]'),'$.affectedAudience','','$.customerImpact','','$.whatStillWorks','','$.details','','$.correctsNoticeId',NULL) WHERE id=? AND version=?").bind(draft.draftId,draft.draftVersion!)] : []),
      ]);
    },
    async publishUpdate(record, previous, notice, statements, draft) {
      const mutation = binding.prepare(`UPDATE maintenance SET state=?,verifying=?,completed_at=?,affected_audience=?,customer_impact=?,what_still_works=?,details=?,auto_start=?,auto_complete=?,remind_prior=?,calendar_sequence=?,updated_at=? WHERE id=? AND updated_at=? AND state=? ${draft?.draftId ? "AND EXISTS (SELECT 1 FROM maintenance_drafts WHERE id=? AND version=?)" : ""}`)
        .bind(record.state,Number(record.verifying),record.completedAt,record.affectedAudience,record.customerImpact,record.whatStillWorks,record.details,Number(record.autoStart),Number(record.autoComplete),Number(record.remindPrior),record.calendarSequence,record.updatedAt,record.id,previous.updatedAt,previous.state,...(draft?.draftId?[draft.draftId,draft.draftVersion!]:[]));
      const consumed = draft?.draftId ? [binding.prepare("UPDATE maintenance_drafts SET version=version+1,payload_json=json_set(payload_json,'$.affectedAudience','','$.customerImpact','','$.whatStillWorks','','$.details','','$.correctsNoticeId',NULL) WHERE id=? AND version=? AND EXISTS (SELECT 1 FROM maintenance_notices WHERE id=?)").bind(draft.draftId,draft.draftVersion!,notice.id)] : [];
      return writeMutationWithNotice(mutation,notice,[...statements,...consumed]);
    },
    async updateWindowWithNotice(maintenanceId, startsAt, endsAt, updatedAt, notice, notificationStatements) {
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET starts_at = ?, ends_at = ?, calendar_sequence=calendar_sequence+1, updated_at = ? WHERE id = ? AND state = 'Scheduled' AND calendar_sequence=?`).bind(startsAt, endsAt, updatedAt, maintenanceId, notice.snapshotJson ? (JSON.parse(notice.snapshotJson) as {calendarSequence:number}).calendarSequence-1 : 0),
        notice,
        notificationStatements,
      );
    },
    async extendInProgressWithNotice(maintenanceId, startsAt, previousEndsAt, endsAt, updatedAt, notice, notificationStatements) {
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET ends_at = ?, calendar_sequence=calendar_sequence+1, updated_at = ? WHERE id = ? AND state = 'In progress' AND starts_at = ? AND ends_at = ? AND julianday(ends_at) < julianday(?)`).bind(endsAt, updatedAt, maintenanceId, startsAt, previousEndsAt, endsAt),
        notice,
        notificationStatements,
      );
    },
    async transitionWithNotice(maintenanceId, from, to, completedAt, updatedAt, notice, notificationStatements, expectedWindow) {
      const windowGuard = expectedWindow ? " AND starts_at = ? AND ends_at = ?" : "";
      const values = [to, completedAt, updatedAt, maintenanceId, from, ...(expectedWindow ? [expectedWindow.startsAt, expectedWindow.endsAt] : [])];
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET state = ?, completed_at = ?, calendar_sequence=calendar_sequence+1, updated_at = ? WHERE id = ? AND state = ?${windowGuard}`).bind(...values),
        notice,
        notificationStatements,
      );
    },
    async cancelWithNotice(maintenanceId, updatedAt, notice, notificationStatements) {
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET state = 'Cancelled', calendar_sequence=calendar_sequence+1, updated_at = ? WHERE id = ? AND state = 'Scheduled'`).bind(updatedAt, maintenanceId),
        notice,
        notificationStatements,
      );
    },
    async listDue(now) {
      return database.select().from(maintenance).where(sql`(state = 'Scheduled' AND starts_at <= ${now}) OR (state = 'In progress' AND ends_at <= ${now})`).all();
    },
    async listReminderDue(now) {
      const due = new Date(Date.parse(now)+24*60*60*1000).toISOString();
      const rows = await database.select().from(maintenance).all();
      const notices = (await binding.prepare("SELECT maintenance_id AS maintenanceId FROM maintenance_notices WHERE kind='reminder'").all<{maintenanceId:string}>()).results;
      return rows.filter(item => item.state === "Scheduled" && item.remindPrior && item.startsAt > now && item.startsAt <= due && !notices.some(notice=>notice.maintenanceId===item.id));
    },
    async writeNotice(input, notificationStatements) {
      const results = await binding.batch([
        noticeStatement(input),
        ...notificationStatements,
      ]);
      return results[0].meta.changes === 1;
    },
    async listImportedUpdates(maintenanceId) {
      return (await binding.prepare("SELECT id,body,published_at AS publishedAt,source_states AS sourceStates,source_status AS sourceStatus FROM import_maintenance_updates WHERE maintenance_id=? ORDER BY published_at DESC,id").bind(maintenanceId).all<ImportedMaintenanceUpdate>()).results;
    },
    async listNotices(maintenanceId) {
      const result = await binding.prepare(`SELECT id, maintenance_id AS maintenanceId, COALESCE(notice_kind,kind) AS kind, snapshot_json AS snapshotJson, corrects_notice_id AS correctsNoticeId, body, published_at AS publishedAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM maintenance_notices WHERE maintenance_id = ? ORDER BY published_at DESC`).bind(maintenanceId).all<MaintenanceNotice>();
      return result.results;
    },
  };
}
