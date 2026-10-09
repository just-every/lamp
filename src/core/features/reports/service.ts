import { createUlid, nowIso } from "../../shared/ids";
import type { ComponentState } from "../../shared/domain";
import { defaultPostmortemDuePolicy, type PostmortemDuePolicy } from "./policies";
import type { IncidentReportRow, ReportRepository } from "./repository";

export interface ReportInput { summary: string; timeline: string; cause: string; remediation: string; }
export interface ReportsNotificationStatements { forIncidentReport(input: { eventId: string; incidentId: string; componentIds: string[]; channels: Array<"email" | "webhook">; queuedAt: string }): Promise<D1PreparedStatement[]>; }
export interface ReportsService {
  get(incidentId: string): Promise<IncidentReportRow | null>;
  save(incidentId: string, input: ReportInput, operatorId: string): Promise<IncidentReportRow>;
  publish(incidentId: string, operatorId: string, channels: Array<"email" | "webhook">): Promise<IncidentReportRow | null>;
  owing(now?: string): Promise<string[]>;
}

function assertReport(input: ReportInput) {
  for (const [name, value] of [["summary", input.summary], ["timeline", input.timeline], ["cause", input.cause], ["remediation", input.remediation]] as const) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 10_000) throw new Error(`${name} is required and must be at most 10,000 characters.`);
  }
}

export function createReportsService(repository: ReportRepository, onPublicDataChanged: () => Promise<void>, duePolicy: PostmortemDuePolicy = defaultPostmortemDuePolicy, notificationStatements: ReportsNotificationStatements | null = null): ReportsService {
  return {
    get: (incidentId) => repository.find(incidentId),
    async save(incidentId, input, operatorId) {
      assertReport(input);
      const existing = await repository.find(incidentId);
      if (existing?.publishedAt) throw new Error("A published report is immutable.");
      const timestamp = nowIso();
      const report: IncidentReportRow = { id: existing?.id ?? createUlid(), incidentId, ...input, publishedAt: null, authorOperatorId: operatorId, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
      await repository.upsert(report);
      return (await repository.find(incidentId))!;
    },
    async publish(incidentId, operatorId, channels) {
      const report = await repository.find(incidentId);
      if (!report || report.publishedAt) return null;
      assertReport(report);
      if (!notificationStatements) throw new Error("Post-incident report publication requires notification transaction wiring.");
      const timestamp = nowIso();
      const componentIds = await repository.listComponentIds(incidentId);
      const notifications = await notificationStatements.forIncidentReport({ eventId: report.id, incidentId, componentIds, channels, queuedAt: timestamp });
      if (!(await repository.publish(incidentId, report.id, timestamp, operatorId, notifications))) return null;
      await onPublicDataChanged();
      return repository.find(incidentId);
    },
    async owing(now = nowIso()) {
      const incidents = await repository.listResolvedWithoutPublishedReport();
      return incidents.filter((incident) => duePolicy.isDue({ resolvedAt: incident.resolvedAt, impact: incident.impact as ComponentState | null, hasPublishedReport: false, now })).map((incident) => incident.id);
    },
  };
}
