import { incidentReportEndStatements } from "../subscribers/incident-lifecycle.repository";
import { readIncidentAgentAttributions } from '../agent-door/incident-attribution.repository';
import type { NativeAttribution } from '../agent-door/provenance.repository';
import { agentAttributionStatements } from '../agent-door/provenance.repository';
import { reportReminderEligibleSql } from "./reminder-eligibility";
import { createUlid } from "../../shared/ids";

export interface IncidentReportRow {
  agentAttribution?: NativeAttribution | null;
  id: string;
  incidentId: string;
  summary: string;
  timeline: string;
  cause: string;
  remediation: string;
  publishedAt: string | null;
  authorOperatorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportRepository {
  find(incidentId: string): Promise<IncidentReportRow | null>;
  createDraft(input: IncidentReportRow): Promise<boolean>;
  upsert(input: IncidentReportRow): Promise<void>;
  publish(incidentId: string, report: IncidentReportRow, publishedAt: string, operatorId: string, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  listComponentIds(incidentId: string): Promise<string[]>;
  listResolvedWithoutPublishedReport(): Promise<Array<{ id: string; reference: string; title: string; lifecycle: string; resolvedAt: string | null; impact: string | null; reminderEligible: number }>>;
  waiver(incidentId: string): Promise<{ reason: string; operatorId: string; createdAt: string } | null>;
  waive(incidentId: string, reason: string, operatorId: string, at: string): Promise<boolean>;
  reminderSent(incidentId: string, week: number): Promise<boolean>;
  recordReminder(incidentId: string, week: number, at: string): Promise<void>;
}

function row(result: Record<string, unknown> | null): IncidentReportRow | null {
  if (!result) return null;
  return {
    id: String(result.id), incidentId: String(result.incidentId), summary: String(result.summary), timeline: String(result.timeline),
    cause: String(result.cause), remediation: String(result.remediation), publishedAt: result.publishedAt === null ? null : String(result.publishedAt),
    authorOperatorId: String(result.authorOperatorId), createdAt: String(result.createdAt), updatedAt: String(result.updatedAt),
  };
}

export function createReportRepository(binding: D1Database): ReportRepository {
  return {
    async find(incidentId) {
      const value=row(await binding.prepare(`SELECT id, incident_id AS incidentId, summary, timeline, cause, remediation, published_at AS publishedAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM incident_reports WHERE incident_id = ?`).bind(incidentId).first());
      if(!value)return null;
      const provenance=await readIncidentAgentAttributions(binding,[value.id]);
      return {...value,agentAttribution:provenance.get(`incident-report:${value.id}`)??null};
    },
    async createDraft(input) {
      const [result] = await binding.batch([binding.prepare(`INSERT INTO incident_reports (id, incident_id, summary, timeline, cause, remediation, published_at, author_operator_id, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM incidents WHERE id = ? AND lifecycle = 'Resolved' AND deleted_at IS NULL)
        ON CONFLICT(incident_id) DO NOTHING`)
        .bind(input.id, input.incidentId, input.summary, input.timeline, input.cause, input.remediation, input.authorOperatorId, input.createdAt, input.updatedAt, input.incidentId),
        ...agentAttributionStatements(binding,{entityType:'incident-report',entityId:input.id,operatorId:input.authorOperatorId,at:input.createdAt,exists:{sql:'EXISTS(SELECT 1 FROM incident_reports WHERE id=? AND created_at=?)',params:[input.id,input.createdAt]}}),
      ]);
      return result.meta.changes === 1;
    },
    async upsert(input) {
      await binding.batch([binding.prepare(`INSERT INTO incident_reports (id, incident_id, summary, timeline, cause, remediation, published_at, author_operator_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(incident_id) DO UPDATE SET summary = excluded.summary, timeline = excluded.timeline, cause = excluded.cause, remediation = excluded.remediation, author_operator_id = excluded.author_operator_id, updated_at = excluded.updated_at
        WHERE incident_reports.published_at IS NULL`)
        .bind(input.id, input.incidentId, input.summary, input.timeline, input.cause, input.remediation, input.publishedAt, input.authorOperatorId, input.createdAt, input.updatedAt),
        ...agentAttributionStatements(binding,{entityType:'incident-report',entityId:input.id,operatorId:input.authorOperatorId,at:input.updatedAt,exists:{sql:'EXISTS(SELECT 1 FROM incident_reports WHERE id=? AND updated_at=? AND published_at IS NULL)',params:[input.id,input.updatedAt]}}),
      ]);
    },
    async publish(incidentId, report, publishedAt, operatorId, notificationStatements) {
      const reportId = report.id;
      // The guard shares the update batch with recipient capture. If a
      // competing publisher (or a non-resolved incident) makes the update a
      // no-op, its NULL payload violates the audit contract and rolls the
      // entire batch back before any notification recipients can exist.
      const guard = binding.prepare(`INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, reason, payload_json, created_at, updated_at)
        VALUES (?, 'incident-report', ?, 'published', ?, NULL,
          CASE WHEN EXISTS (SELECT 1 FROM incident_reports WHERE id = ? AND incident_id = ? AND published_at = ?) THEN '{}' ELSE NULL END,
          ?, ?)`)
        .bind(`${reportId}-publish-${publishedAt}`, reportId, operatorId, reportId, incidentId, publishedAt, publishedAt, publishedAt);
      try {
        await binding.batch([
          binding.prepare(`UPDATE incident_reports SET published_at = ?, author_operator_id = ?, updated_at = ? WHERE incident_id = ? AND id = ? AND published_at IS NULL AND EXISTS (SELECT 1 FROM incidents WHERE incidents.id = ? AND incidents.lifecycle = 'Resolved' AND incidents.deleted_at IS NULL) AND summary = ? AND timeline = ? AND cause = ? AND remediation = ?`)
            .bind(publishedAt, operatorId, publishedAt, incidentId, reportId, incidentId, report.summary, report.timeline, report.cause, report.remediation),
          guard,
          ...agentAttributionStatements(binding,{entityType:'incident-report',entityId:reportId,operatorId,at:publishedAt,publication:true}),
          ...notificationStatements,
          ...incidentReportEndStatements(binding,incidentId,reportId,publishedAt),
        ]);
      } catch {
        return false;
      }
      return Boolean(await binding.prepare(`SELECT 1 AS published FROM incident_reports WHERE id = ? AND incident_id = ? AND published_at = ?`).bind(reportId, incidentId, publishedAt).first<{ published: number }>());
    },
    async waiver(incidentId) { return binding.prepare("SELECT reason,operator_id AS operatorId,created_at AS createdAt FROM report_waivers WHERE incident_id=?").bind(incidentId).first<{ reason: string; operatorId: string; createdAt: string }>(); },
    async waive(incidentId, reason, operatorId, at) {
      const [changed] = await binding.batch([
        binding.prepare(`INSERT INTO report_waivers(incident_id,reason,operator_id,created_at)
          SELECT id,?,?,? FROM incidents WHERE id=? AND lifecycle='Resolved' AND deleted_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM incident_reports WHERE incident_id=incidents.id AND published_at IS NOT NULL)
          ON CONFLICT(incident_id) DO NOTHING RETURNING incident_id`).bind(reason,operatorId,at,incidentId),
        binding.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,reason,payload_json,created_at,updated_at)
          SELECT ?,'incident-report',?,'report.waived',?,?,'{}',?,? WHERE changes()=1`).bind(createUlid(),incidentId,operatorId,reason,at,at),
        ...agentAttributionStatements(binding,{entityType:'incident-report',entityId:incidentId,operatorId,at,exists:{sql:'EXISTS(SELECT 1 FROM report_waivers WHERE incident_id=? AND created_at=? AND operator_id=?)',params:[incidentId,at,operatorId]}}),
      ]);
      return changed.results.length===1;
    },
    async reminderSent(incidentId, week) { return Boolean(await binding.prepare("SELECT 1 FROM report_reminders WHERE incident_id=? AND week=?").bind(incidentId,week).first()); },
    async recordReminder(incidentId, week, at) { await binding.prepare("INSERT OR IGNORE INTO report_reminders(incident_id,week,recorded_at) VALUES(?,?,?)").bind(incidentId,week,at).run(); },
    async listComponentIds(incidentId) { return (await binding.prepare(`SELECT component_id AS componentId FROM incident_components WHERE incident_id = ? AND component_id IS NOT NULL`).bind(incidentId).all<{ componentId: string }>()).results.map((row) => row.componentId); },
    async listResolvedWithoutPublishedReport() {
      const result = await binding.prepare(`SELECT incidents.id, incidents.reference, incidents.title, incidents.lifecycle, incidents.resolved_at AS resolvedAt, incidents.peak_impact AS impact,
        ${reportReminderEligibleSql("incidents")} AS reminderEligible
        FROM incidents LEFT JOIN incident_reports ON incident_reports.incident_id = incidents.id AND incident_reports.published_at IS NOT NULL
        WHERE incidents.lifecycle = 'Resolved' AND incidents.deleted_at IS NULL AND incident_reports.id IS NULL AND NOT EXISTS(SELECT 1 FROM report_waivers WHERE incident_id=incidents.id)`).all<{ id: string; reference: string; title: string; lifecycle: string; resolvedAt: string | null; impact: string | null; reminderEligible: number }>();
      return result.results;
    },
  };
}
