import { createUlid, nowIso } from "../../shared/ids";
import type { BriefService } from "../brief/service";
import { draftIncidentReport, reportReview, ReportInputError, ReportDraftError, type ReportReview } from "./draft";
import type { ComponentState } from "../../shared/domain";
import { defaultPostmortemDuePolicy, type PostmortemDuePolicy } from "./policies";
import type { IncidentReportRow, ReportRepository } from "./repository";

export interface ReportInput { summary: string; timeline: string; cause: string; remediation: string; }
export interface ReportsNotificationStatements { forIncidentReport(input: { eventId: string; incidentId: string; componentIds: string[]; channels: Array<"email" | "webhook">; queuedAt: string }): Promise<D1PreparedStatement[]>; }
export interface ReportsService {
  draft(incidentId: string, operatorId: string): Promise<{ report: IncidentReportRow; review: ReportReview }>;
  get(incidentId: string): Promise<IncidentReportRow | null>;
  save(incidentId: string, input: ReportInput, operatorId: string): Promise<IncidentReportRow>;
  publish(incidentId: string, operatorId: string, channels: Array<"email" | "webhook">): Promise<IncidentReportRow | null>;
  owing(now?: string): Promise<string[]>;
}

function assertReport(input: ReportInput, complete = false) {
  for (const name of ["summary", "timeline", "cause", "remediation"] as const) {
    const value = input[name];
    if (typeof value !== "string" || value.length > 10_000 || (complete && !value.trim())) throw new ReportInputError(`${name} is required before publication and must be at most 10,000 characters.`);
  }
  if (complete) {
    const review = reportReview(input);
    if (review.cause.required || review.remediation.required) throw new ReportInputError("An operator must write the cause and remediation before publication.");
  }
}

export function createReportsService(repository: ReportRepository, onPublicDataChanged: () => Promise<void>, duePolicy: PostmortemDuePolicy = defaultPostmortemDuePolicy, notificationStatements: ReportsNotificationStatements | null = null, briefs: BriefService | null = null): ReportsService {
  return {
    async draft(incidentId, operatorId) {
      if (!briefs) throw new Error("Post-incident report drafting requires incident brief wiring.");
      const brief = await briefs.get(incidentId);
      if (!brief) throw new ReportDraftError("Incident not found.", 404);
      if (brief.incident.lifecycle !== "Resolved") throw new ReportDraftError("Resolve the incident before drafting a report.", 409);
      if (await repository.find(incidentId)) throw new ReportDraftError("A report already exists. Edit the saved report; drafting never replaces it.", 409);
      const input = draftIncidentReport(brief);
      const timestamp = nowIso();
      const report: IncidentReportRow = { id: createUlid(), incidentId, ...input, publishedAt: null, authorOperatorId: operatorId, createdAt: timestamp, updatedAt: timestamp };
      if (!(await repository.createDraft(report))) throw new ReportDraftError("A report already exists or the incident is no longer resolved. Reload before editing.", 409);
      return { report, review: reportReview(report, [...brief.whatWeKnow.alerts, ...brief.whatWeKnow.updates].map((item) => item.ref)) };
    },
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
      assertReport(report, true);
      if (!notificationStatements) throw new Error("Post-incident report publication requires notification transaction wiring.");
      const timestamp = nowIso();
      const componentIds = await repository.listComponentIds(incidentId);
      const notifications = await notificationStatements.forIncidentReport({ eventId: report.id, incidentId, componentIds, channels, queuedAt: timestamp });
      if (!(await repository.publish(incidentId, report, timestamp, operatorId, notifications))) return null;
      await onPublicDataChanged();
      return repository.find(incidentId);
    },
    async owing(now = nowIso()) {
      const incidents = await repository.listResolvedWithoutPublishedReport();
      return incidents.filter((incident) => duePolicy.isDue({ resolvedAt: incident.resolvedAt, impact: incident.impact as ComponentState | null, hasPublishedReport: false, now })).map((incident) => incident.id);
    },
  };
}
