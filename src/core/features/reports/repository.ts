export interface IncidentReportRow {
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
  upsert(input: IncidentReportRow): Promise<void>;
  publish(incidentId: string, reportId: string, publishedAt: string, operatorId: string, notificationStatements: D1PreparedStatement[]): Promise<boolean>;
  listComponentIds(incidentId: string): Promise<string[]>;
  listResolvedWithoutPublishedReport(): Promise<Array<{ id: string; lifecycle: string; resolvedAt: string | null; impact: string | null }>>;
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
      return row(await binding.prepare(`SELECT id, incident_id AS incidentId, summary, timeline, cause, remediation, published_at AS publishedAt, author_operator_id AS authorOperatorId, created_at AS createdAt, updated_at AS updatedAt FROM incident_reports WHERE incident_id = ?`).bind(incidentId).first());
    },
    async upsert(input) {
      await binding.prepare(`INSERT INTO incident_reports (id, incident_id, summary, timeline, cause, remediation, published_at, author_operator_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(incident_id) DO UPDATE SET summary = excluded.summary, timeline = excluded.timeline, cause = excluded.cause, remediation = excluded.remediation, author_operator_id = excluded.author_operator_id, updated_at = excluded.updated_at
        WHERE incident_reports.published_at IS NULL`)
        .bind(input.id, input.incidentId, input.summary, input.timeline, input.cause, input.remediation, input.publishedAt, input.authorOperatorId, input.createdAt, input.updatedAt).run();
    },
    async publish(incidentId, reportId, publishedAt, operatorId, notificationStatements) {
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
          binding.prepare(`UPDATE incident_reports SET published_at = ?, author_operator_id = ?, updated_at = ? WHERE incident_id = ? AND id = ? AND published_at IS NULL AND EXISTS (SELECT 1 FROM incidents WHERE incidents.id = ? AND incidents.lifecycle = 'Resolved')`)
            .bind(publishedAt, operatorId, publishedAt, incidentId, reportId, incidentId),
          guard,
          ...notificationStatements,
        ]);
      } catch {
        return false;
      }
      return Boolean(await binding.prepare(`SELECT 1 AS published FROM incident_reports WHERE id = ? AND incident_id = ? AND published_at = ?`).bind(reportId, incidentId, publishedAt).first<{ published: number }>());
    },
    async listComponentIds(incidentId) { return (await binding.prepare(`SELECT component_id AS componentId FROM incident_components WHERE incident_id = ? AND component_id IS NOT NULL`).bind(incidentId).all<{ componentId: string }>()).results.map((row) => row.componentId); },
    async listResolvedWithoutPublishedReport() {
      const result = await binding.prepare(`SELECT incidents.id, incidents.lifecycle, incidents.resolved_at AS resolvedAt, incidents.peak_impact AS impact
        FROM incidents LEFT JOIN incident_reports ON incident_reports.incident_id = incidents.id AND incident_reports.published_at IS NOT NULL
        WHERE incidents.lifecycle = 'Resolved' AND incidents.deleted_at IS NULL AND incident_reports.id IS NULL`).all<{ id: string; lifecycle: string; resolvedAt: string | null; impact: string | null }>();
      return result.results;
    },
  };
}
