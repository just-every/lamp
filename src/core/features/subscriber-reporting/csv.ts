import type { SubscriberReportingResponse } from "./types";

const columns = ["scope", "channel", "state", "component_id", "component_name", "group_name", "deactivation_reason", "count", "day", "joined", "left", "net_change", "opening_inventory", "closing_inventory", "baseline_eligible", "total", "eligible", "timezone", "from_inclusive", "to_exclusive", "measured_at", "tracking_started_at", "coverage", "unsupported_dimensions", "definition_name", "definition"] as const;
type Row = Partial<Record<typeof columns[number], unknown>>;
function cell(value: unknown) {
  const text = String(value ?? "");
  const safe = typeof value === "string" && (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function subscriberReportingCsv(report: SubscriberReportingResponse): string {
  const common: Row = { timezone: report.timezone, from_inclusive: report.from, to_exclusive: report.to, measured_at: report.measuredAt, tracking_started_at: report.trackingStartedAt, coverage: report.coverage, unsupported_dimensions: report.unsupportedDimensions.join(";") };
  const rows: Row[] = [
    { scope: "summary", total: report.total, eligible: report.eligible },
    ...report.counts.map(row => ({ scope: "current", ...row })),
    ...report.components.map(row => ({ scope: "component", channel: row.channel, state: row.state, component_id: row.componentId, component_name: row.componentName, group_name: row.groupName, count: row.count })),
    ...report.deactivationReasons.map(row => ({ scope: "deactivation-reason", channel: row.channel, deactivation_reason: row.reason ?? "unknown", count: row.count })),
    ...report.baseline.map(row => ({ scope: "baseline", channel: row.channel, baseline_eligible: row.eligible })),
    ...report.daily.map(row => ({ scope: "daily", channel: row.channel, day: row.day, joined: row.joined, left: row.left, net_change: row.netChange, opening_inventory: row.openingInventory, closing_inventory: row.closingInventory })),
    ...Object.entries(report.definitions).map(([name, definition]) => ({ scope: "definition", definition_name: name, definition })),
  ];
  return [columns.map(cell).join(","), ...rows.map(row => columns.map(key => cell(({ ...common, ...row })[key])).join(","))].join("\r\n") + "\r\n";
}
