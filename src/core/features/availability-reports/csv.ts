import type { AvailabilityReport } from "./types";

const headers = ["record_type", "component_id", "component_name", "period", "timezone", "period_start", "period_end_exclusive", "observed_until", "basis", "uptime", "weighted_downtime_minutes", "tracking_since", "coverage_whole_days", "id", "reference", "title", "state", "starts_at", "ends_at", "method"] as const;
type Row = Partial<Record<typeof headers[number], string | number | null>>;
function cell(value: unknown) {
  const text = String(value ?? "");
  return `"${(/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}
export function availabilityCsv(report: AvailabilityReport): string {
  const context = { component_id: report.component.id, component_name: report.component.name, period: report.period, timezone: report.timezone, period_start: report.startsAt, period_end_exclusive: report.endsAt, observed_until: report.observedUntil, basis: report.basis };
  const rows: Row[] = [
    { ...context, record_type: "summary", uptime: report.uptime ?? "No data", weighted_downtime_minutes: report.downtimeMinutes ?? "No data", tracking_since: report.trackingSince, coverage_whole_days: report.coverageDays, method: report.method },
    ...(["incidents", "maintenance"] as const).flatMap(kind => report[kind].map(record => ({ ...context, record_type: kind === "incidents" ? "incident" : "maintenance", id: record.id, reference: record.reference, title: record.title, state: record.state, starts_at: record.startsAt, ends_at: record.endsAt }))),
  ];
  return [headers.map(cell).join(","), ...rows.map(row => headers.map(key => cell(row[key])).join(","))].join("\r\n") + "\r\n";
}
