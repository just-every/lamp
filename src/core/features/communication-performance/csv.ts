import type { IncidentPerformance, IncidentReachResponse, PerformanceResponse, ReachSummary } from "./types";

const header = [
  "scope", "incident_id", "reference", "title", "update_id", "channel", "coverage", "committed", "distinct_committed", "provider_accepted", "distinct_provider_accepted", "delivered", "distinct_delivered", "queued", "bounced", "complained", "suppressed", "failed", "first_provider_accepted_at",
  "first_accepted_alert_at", "first_public_update_at", "first_update_latency_ms", "resolution_duration_ms", "commitments_kept", "commitments_missed", "commitments_pending", "reports_owed", "failure_numerator", "failure_denominator", "failure_rate", "failure_denominator_label",
  "timezone", "measured_at", "month", "cohort_start", "cohort_end", "incident_count", "known_first_update_latency_count", "unknown_first_update_latency_count", "first_update_latency_total_ms", "average_first_update_latency_ms", "resolved_duration_count", "resolution_duration_total_ms", "average_resolution_duration_ms", "unknown_delivery_updates",
  "operator_posts_committed", "operator_posts_accepted", "operator_posts_rejected", "operator_posts_uncertain", "operator_posts_pending", "definition_name", "definition",
] as const;
type CsvRow = Partial<Record<typeof header[number], unknown>>;
function cell(value: unknown) {
  const text = String(value ?? "unknown");
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}
const line = (row: CsvRow) => header.map(key => cell(key in row ? row[key] : "")).join(",");
function rows(reach: ReachSummary, context: CsvRow): CsvRow[] {
  const common = { ...context, unknown_delivery_updates: reach.unknownDeliveryUpdates, failure_numerator: reach.deliveryFailure.failures, failure_denominator: reach.deliveryFailure.denominator, failure_rate: reach.deliveryFailure.rate, failure_denominator_label: reach.deliveryFailure.denominatorLabel };
  return [
    ...reach.channels.map(channel => ({ ...common, channel: channel.channel, coverage: channel.coverage,
      committed: channel.committed, distinct_committed: channel.distinctCommitted, provider_accepted: channel.providerAccepted, distinct_provider_accepted: channel.distinctProviderAccepted,
      delivered: channel.delivered, distinct_delivered: channel.distinctDelivered, queued: channel.queued, bounced: channel.bounced, complained: channel.complained, suppressed: channel.suppressed, failed: channel.failed, first_provider_accepted_at: channel.firstProviderAcceptedAt,
    })),
    ...reach.operatorPosts.map(post => ({ ...context, scope: `${context.scope}-operator-posts`, channel: post.channel, operator_posts_committed: post.committed, operator_posts_accepted: post.accepted, operator_posts_rejected: post.rejected, operator_posts_uncertain: post.uncertain, operator_posts_pending: post.pending })),
  ];
}
function incidentContext(incident: IncidentPerformance): CsvRow {
  return { incident_id: incident.incidentId, reference: incident.reference, title: incident.title, first_accepted_alert_at: incident.firstAcceptedAlertAt, first_public_update_at: incident.firstPublicUpdateAt, first_update_latency_ms: incident.firstUpdateLatencyMs, resolution_duration_ms: incident.resolutionDurationMs, commitments_kept: incident.commitments.kept, commitments_missed: incident.commitments.missed, commitments_pending: incident.commitments.pending, reports_owed: Number(incident.reportOwed) };
}
function serialize(data: { definitions: Record<string, string> }, records: CsvRow[]): string {
  return [header.map(cell).join(","), ...records.map(line), ...Object.entries(data.definitions).map(([name, definition]) => line({ scope: "definition", definition_name: name, definition }))].join("\r\n") + "\r\n";
}
export function reachCsv(data: IncidentReachResponse): string {
  const context = { timezone: data.timezone, measured_at: data.measuredAt, incident_id: data.incidentId, reference: data.incident.reference, title: data.incident.title };
  return serialize(data, [
    ...rows(data.incident, { ...context, ...incidentContext(data.incident), scope: "incident" }),
    ...data.updates.flatMap(update => rows(update, { ...context, scope: "update", update_id: update.updateId })),
  ]);
}
export function performanceCsv(data: PerformanceResponse): string {
  const context = { timezone: data.timezone, measured_at: data.measuredAt, month: data.month, cohort_start: data.startsAt, cohort_end: data.endsAt };
  return serialize(data, [
    ...rows(data.summary, { ...context, scope: "month", incident_count: data.summary.incidentCount, commitments_kept: data.summary.commitments.kept, commitments_missed: data.summary.commitments.missed, commitments_pending: data.summary.commitments.pending, reports_owed: data.summary.reportsOwed,
      known_first_update_latency_count: data.summary.knownFirstUpdateLatencyCount, unknown_first_update_latency_count: data.summary.unknownFirstUpdateLatencyCount, first_update_latency_total_ms: data.summary.firstUpdateLatencyTotalMs, average_first_update_latency_ms: data.summary.averageFirstUpdateLatencyMs, resolved_duration_count: data.summary.resolvedDurationCount, resolution_duration_total_ms: data.summary.resolutionDurationTotalMs, average_resolution_duration_ms: data.summary.averageResolutionDurationMs,
    }),
    ...data.incidents.flatMap(incident => rows(incident, { ...context, ...incidentContext(incident), scope: "incident" })),
  ]);
}
