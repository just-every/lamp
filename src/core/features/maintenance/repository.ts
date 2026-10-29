import { automationStatement, createMaintenanceAutomationRepository, type MaintenanceAutomation } from "./automation.repository";
import { asc, eq } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";
import { allocateReference, type AllocatedReference } from "../../shared/references/repository";
import { createUlid } from "../../shared/ids";
import { maintenance, maintenanceComponents } from "../../shared/schema";
import { agentAttributionStatements, agentQueuedOperationStatements, nativeAgentAttribution, type NativeAttribution } from '../agent-door/provenance.repository';

export type StoredMaintenance = typeof maintenance.$inferSelect;
export type MaintenanceWording = Pick<StoredMaintenance, "affectedAudience" | "customerImpact">;
export type StoredMaintenanceComponent = typeof maintenanceComponents.$inferSelect;
export interface MaintenanceNotice { id: string; maintenanceId: string; kind: "scheduled" | "rescheduled" | "reminder" | "started" | "completed" | "cancelled"; body: string; publishedAt: string; authorOperatorId: string | null; createdAt: string; updatedAt: string; }

export interface ImportedMaintenanceUpdate { id: string; body: string; publishedAt: string; sourceStates: string }

export interface MaintenanceCollectionDetails {
  components: StoredMaintenanceComponent[];
  notices: MaintenanceNotice[];
  importedUpdates: Array<ImportedMaintenanceUpdate & { maintenanceId: string }>;
  agentAttributions: Map<string, NativeAttribution>;
}

export interface MaintenanceRepository {
  agentAttribution(maintenanceId: string, at: string): Promise<NativeAttribution | null>;
  automation: ReturnType<typeof createMaintenanceAutomationRepository>;
  listCollectionDetails(): Promise<MaintenanceCollectionDetails>;
  listImportedUpdates(maintenanceId: string): Promise<ImportedMaintenanceUpdate[]>;
  allocateMaintenanceReference(): Promise<AllocatedReference>;
  listMaintenance(): Promise<StoredMaintenance[]>;
  listComponents(maintenanceId: string): Promise<StoredMaintenanceComponent[]>;
  find(maintenanceId: string): Promise<StoredMaintenance | null>;
  create(input: typeof maintenance.$inferInsert & MaintenanceWording, components: Array<typeof maintenanceComponents.$inferInsert>, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[], automation?: Partial<MaintenanceAutomation>): Promise<void>;
  updateWindowWithNotice(maintenanceId: string, startsAt: string, endsAt: string, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[], automation?: Partial<MaintenanceAutomation>, wording?: MaintenanceWording): Promise<boolean>;
  extendInProgressWithNotice(maintenanceId: string, startsAt: string, previousEndsAt: string, endsAt: string, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[], automation?: Partial<MaintenanceAutomation>, wording?: MaintenanceWording): Promise<boolean>;
  transitionWithNotice(maintenanceId: string, from: "Scheduled" | "In progress", to: "In progress" | "Completed", completedAt: string | null, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[], expectedWindow?: Pick<StoredMaintenance, "startsAt" | "endsAt"> & Partial<MaintenanceAutomation>): Promise<boolean>;
  cancelWithNotice(maintenanceId: string, updatedAt: string, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  listDue(now: string): Promise<StoredMaintenance[]>;
  listReminderDue(now: string): Promise<StoredMaintenance[]>;
  writeNotice(input: MaintenanceNotice, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  listNotices(maintenanceId: string): Promise<MaintenanceNotice[]>;
}

export function createMaintenanceRepository(binding: D1Database): MaintenanceRepository {
  const database = createDatabase(binding);
  const noticeStatement = (notice: MaintenanceNotice) => binding.prepare(`INSERT OR IGNORE INTO maintenance_notices (id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(notice.id, notice.maintenanceId, notice.kind, notice.body, notice.publishedAt, notice.authorOperatorId, notice.createdAt, notice.updatedAt);
  const writeMutationWithNotice = async (mutation: D1PreparedStatement, notice: MaintenanceNotice, notificationStatements: D1PreparedStatement[], automation?: Partial<MaintenanceAutomation>, plan?: {startsAt:string;endsAt:string}) => {
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
      ...(notice.authorOperatorId ? agentAttributionStatements(binding, { entityType: 'maintenance', entityId: notice.maintenanceId, operatorId: notice.authorOperatorId, at: notice.createdAt,
        guard: { sql: 'EXISTS(SELECT 1 FROM audit_entries WHERE id=?)', params: [auditId] } }) : []),
      ...(notice.authorOperatorId ? agentAttributionStatements(binding, { entityType: 'maintenance-notice', entityId: notice.id, operatorId: notice.authorOperatorId, at: notice.createdAt,
        guard: { sql: 'EXISTS(SELECT 1 FROM maintenance_notices WHERE id=?)', params: [notice.id] } }) : []),
      ...(automation ? [automationStatement(binding,notice.maintenanceId,automation,notice.id)] : []),
      ...(plan ? (['start', 'complete', 'reminder'] as const).flatMap(action => agentQueuedOperationStatements(binding, {
        kind: `maintenance-${action}`, id: notice.maintenanceId, tool: `lamp.maintenance.${action === 'reminder' ? 'remind' : action}`,
        args: { id: notice.maintenanceId, idempotency_key: `maintenance/${notice.maintenanceId}/${plan.startsAt}/${plan.endsAt}/${action}` }, at: notice.createdAt,
        guard: {sql:'EXISTS(SELECT 1 FROM audit_entries WHERE id=?)',params:[auditId]},
      })) : []),
      ...notificationStatements,
    ]);
    return results[1]?.meta.changes === 1;
  };

  return {
    agentAttribution: (id,at) => nativeAgentAttribution(binding,'maintenance',id,at),
    automation: createMaintenanceAutomationRepository(binding),
    async allocateMaintenanceReference() { return allocateReference(binding, "SCH"); },
    async listMaintenance() {
      return database.select().from(maintenance).orderBy(asc(maintenance.startsAt)).all();
    },
    async listCollectionDetails() {
      const [components, notices, importedUpdates] = await Promise.all([
        database.select().from(maintenanceComponents).orderBy(maintenanceComponents.maintenanceId).all(),
        binding.prepare(`SELECT id, maintenance_id AS maintenanceId, kind, body, published_at AS publishedAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM maintenance_notices ORDER BY maintenance_id, published_at DESC`).all<MaintenanceNotice>(),
        binding.prepare(`SELECT id, maintenance_id AS maintenanceId, body, published_at AS publishedAt, source_states AS sourceStates FROM import_maintenance_updates ORDER BY maintenance_id, published_at DESC, id`).all<ImportedMaintenanceUpdate & { maintenanceId: string }>(),
      ]);
      const attributed = (await binding.prepare(`SELECT p.entity_id AS id,p.agent_id AS agentId,p.agent_name AS agentName,p.operator_id AS sponsorId,
        CASE WHEN o.id IS NULL OR o.email='deleted-' || lower(o.id) || '@operator.invalid'
          THEN 'Erased operator · ' || p.operator_id ELSE o.display_name END AS sponsorName,
        (SELECT json_group_array(json_object('id',json_extract(j.value,'$.id'),'name',
          CASE WHEN a.id IS NULL OR a.email='deleted-' || lower(a.id) || '@operator.invalid'
            THEN 'Erased operator · ' || json_extract(j.value,'$.id') ELSE a.display_name END))
          FROM json_each(p.approvers_json) j LEFT JOIN oa_operators a ON a.id=json_extract(j.value,'$.id')) AS approvers
        FROM lamp_agent_attribution p JOIN maintenance m ON m.id=p.entity_id AND m.updated_at=p.created_at
        LEFT JOIN oa_operators o ON o.id=p.operator_id WHERE p.entity_type='maintenance'`)
        .all<{id:string;agentId:string;agentName:string;sponsorId:string;sponsorName:string;approvers:string}>()).results;
      const agentAttributions = new Map(attributed.map(row => [row.id,{agent:{id:row.agentId,name:row.agentName},sponsor:{id:row.sponsorId,name:row.sponsorName},approvers:JSON.parse(row.approvers),label:`${row.agentName} for ${row.sponsorName}`} satisfies NativeAttribution]));
      return { components, notices: notices.results, importedUpdates: importedUpdates.results, agentAttributions };
    },
    async listComponents(maintenanceId) {
      return database.select().from(maintenanceComponents).where(eq(maintenanceComponents.maintenanceId, maintenanceId)).all();
    },
    async find(maintenanceId) {
      const item = await database.select().from(maintenance).where(eq(maintenance.id, maintenanceId)).get();
      return item ?? null;
    },
    async create(input, attached, notice, notificationStatements, automation = {}) {
      await binding.batch([
        binding.prepare(`INSERT INTO maintenance (id,reference,title,state,starts_at,ends_at,completed_at,created_by_operator_id,created_at,updated_at,affected_audience,customer_impact) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(input.id, input.reference, input.title, input.state, input.startsAt, input.endsAt, input.completedAt, input.createdByOperatorId, input.createdAt, input.updatedAt, input.affectedAudience, input.customerImpact),
        ...attached.map((component) => binding.prepare(`INSERT INTO maintenance_components (id,maintenance_id,component_id,component_name,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).bind(component.id, component.maintenanceId, component.componentId, component.componentName, component.state, component.createdAt, component.updatedAt)),
        binding.prepare(`INSERT INTO maintenance_notices (id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).bind(notice.id, notice.maintenanceId, notice.kind, notice.body, notice.publishedAt, notice.authorOperatorId, notice.createdAt, notice.updatedAt),
        binding.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) VALUES (?, 'maintenance', ?, 'notice-published', ?, ?, ?, ?)").bind(`${notice.id}-audit`, input.id, notice.authorOperatorId, JSON.stringify({ kind: notice.kind }), notice.createdAt, notice.updatedAt),
        ...agentAttributionStatements(binding, { entityType: 'maintenance', entityId: input.id, operatorId: input.createdByOperatorId, at: notice.createdAt }),
        ...agentAttributionStatements(binding, { entityType: 'maintenance-notice', entityId: notice.id, operatorId: input.createdByOperatorId, at: notice.createdAt }),
        ...(['start', 'complete', 'reminder'] as const).flatMap(action => agentQueuedOperationStatements(binding, {
          kind: `maintenance-${action}`, id: input.id, tool: `lamp.maintenance.${action === 'reminder' ? 'remind' : action}`,
          args: { id: input.id, idempotency_key: `maintenance/${input.id}/${input.startsAt}/${input.endsAt}/${action}` }, at: notice.createdAt,
        })),
        automationStatement(binding,input.id,automation,notice.id),
        ...notificationStatements,
      ]);
    },
    async updateWindowWithNotice(maintenanceId, startsAt, endsAt, updatedAt, notice, notificationStatements, automation, wording) {
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET starts_at = ?, ends_at = ?, updated_at = ?${wording ? ", affected_audience = ?, customer_impact = ?" : ""} WHERE id = ? AND state = 'Scheduled'`).bind(startsAt, endsAt, updatedAt, ...(wording ? [wording.affectedAudience, wording.customerImpact] : []), maintenanceId),
        notice,
        notificationStatements,
        automation,
        {startsAt,endsAt},
      );
    },
    async extendInProgressWithNotice(maintenanceId, startsAt, previousEndsAt, endsAt, updatedAt, notice, notificationStatements, automation, wording) {
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET ends_at = ?, updated_at = ?${wording ? ", affected_audience = ?, customer_impact = ?" : ""} WHERE id = ? AND state = 'In progress' AND starts_at = ? AND ends_at = ? AND julianday(ends_at) ${automation ? '<=' : '<'} julianday(?)`).bind(endsAt, updatedAt, ...(wording ? [wording.affectedAudience, wording.customerImpact] : []), maintenanceId, startsAt, previousEndsAt, endsAt),
        notice,
        notificationStatements,
        automation,
        {startsAt,endsAt},
      );
    },
    async transitionWithNotice(maintenanceId, from, to, completedAt, updatedAt, notice, notificationStatements, expectedWindow) {
      const windowGuard = expectedWindow ? " AND starts_at = ? AND ends_at = ?" : "";
      const automationGuard = [expectedWindow?.autoStart === undefined ? "" : ` AND COALESCE((SELECT auto_start FROM maintenance_automation WHERE maintenance_id=maintenance.id),1)=${Number(expectedWindow.autoStart)}`,expectedWindow?.autoComplete === undefined ? "" : ` AND COALESCE((SELECT auto_complete FROM maintenance_automation WHERE maintenance_id=maintenance.id),1)=${Number(expectedWindow.autoComplete)}`].join("");
      const values = [to, completedAt, updatedAt, maintenanceId, from, ...(expectedWindow ? [expectedWindow.startsAt, expectedWindow.endsAt] : [])];
      return writeMutationWithNotice(
        binding.prepare(`UPDATE maintenance SET state = ?, completed_at = ?, updated_at = ? WHERE id = ? AND state = ?${windowGuard}${automationGuard}`).bind(...values),
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
      const result = await binding.prepare(`SELECT id, reference, title, affected_audience AS affectedAudience, customer_impact AS customerImpact, state, starts_at AS startsAt, ends_at AS endsAt, completed_at AS completedAt, created_by_operator_id AS createdByOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM maintenance WHERE (state = 'Scheduled' AND starts_at <= ?) OR (state = 'In progress' AND ends_at <= ?)`).bind(now, now).all<StoredMaintenance>();
      return result.results;
    },
    async listReminderDue(now) {
      const result = await binding.prepare(`SELECT maintenance.id, maintenance.reference, maintenance.title, maintenance.affected_audience AS affectedAudience, maintenance.customer_impact AS customerImpact, maintenance.state, maintenance.starts_at AS startsAt, maintenance.ends_at AS endsAt, maintenance.completed_at AS completedAt, maintenance.created_by_operator_id AS createdByOperatorId, maintenance.created_at AS createdAt, maintenance.updated_at AS updatedAt FROM maintenance LEFT JOIN maintenance_notices ON maintenance_notices.maintenance_id = maintenance.id AND maintenance_notices.kind = 'reminder' WHERE maintenance.state = 'Scheduled' AND maintenance.starts_at <= ? AND maintenance.starts_at > ? AND maintenance_notices.id IS NULL`).bind(new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString(), now).all<StoredMaintenance>();
      return result.results;
    },
    async writeNotice(input, notificationStatements) {
      const results = await binding.batch([
        noticeStatement(input),
        binding.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, payload_json, created_at, updated_at) SELECT ?, 'maintenance', ?, 'notice-published', ?, ?, ?, ? WHERE changes() = 1").bind(`${input.id}-audit`, input.maintenanceId, input.authorOperatorId, JSON.stringify({ kind: input.kind }), input.createdAt, input.updatedAt),
        ...(input.authorOperatorId ? agentAttributionStatements(binding, { entityType: 'maintenance', entityId: input.maintenanceId, operatorId: input.authorOperatorId, at: input.createdAt,
          guard: { sql: 'EXISTS(SELECT 1 FROM audit_entries WHERE id=?)', params: [`${input.id}-audit`] } }) : []),
        ...(input.authorOperatorId ? agentAttributionStatements(binding, { entityType: 'maintenance-notice', entityId: input.id, operatorId: input.authorOperatorId, at: input.createdAt,
          guard: { sql: 'EXISTS(SELECT 1 FROM audit_entries WHERE id=?)', params: [`${input.id}-audit`] } }) : []),
        ...notificationStatements,
      ]);
      return results[0].meta.changes === 1;
    },
    async listImportedUpdates(maintenanceId) {
      return (await binding.prepare("SELECT id,body,published_at AS publishedAt,source_states AS sourceStates FROM import_maintenance_updates WHERE maintenance_id=? ORDER BY published_at DESC,id").bind(maintenanceId).all<ImportedMaintenanceUpdate>()).results;
    },
    async listNotices(maintenanceId) {
      const result = await binding.prepare(`SELECT id, maintenance_id AS maintenanceId, kind, body, published_at AS publishedAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM maintenance_notices WHERE maintenance_id = ? ORDER BY published_at DESC`).bind(maintenanceId).all<MaintenanceNotice>();
      return result.results;
    },
  };
}
