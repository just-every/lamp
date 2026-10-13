import type { z } from "zod";
import type { Accounting } from "../rows";
import type { SourceData, SourceIncident } from "../source";
import { schemas, sourceTime, type BetterPage, type BetterReport, type BetterSubscriber, type BetterUpdate } from "./schema";

const states: Record<string, string> = { operational: "operational", resolved: "operational", maintenance: "under_maintenance", degraded: "degraded_performance", downtime: "major_outage" };
function state(value: string) {
  const mapped = states[value.toLowerCase()];
  if (!mapped) throw new Error(`Better Stack state '${value}' cannot be represented by Lamp (including paused/not_monitored resources).`);
  return mapped;
}

/** Explicit normalization only: raw REST resources remain in the reader's records. */
export function normalizeBetterStack(page: BetterPage, sections: z.infer<typeof schemas.section>[], components: z.infer<typeof schemas.component>[], reports: BetterReport[], updates: Map<string, BetterUpdate[]>, subscribers: BetterSubscriber[]): { data: SourceData; accounting: Accounting[] } {
  const data: SourceData = { groups: [], components: [], incidents: [], maintenance: [], subscribers: [] };
  const accounting: Accounting[] = [];
  const sectionIds = new Set(sections.map((row) => row.id));
  const componentIds = new Set(components.map((row) => row.id));
  const unique = <T extends { id: string }>(rows: T[]) => rows.filter((row, index) => rows.findIndex((other) => row.id === other.id) === index);
  data.groups = unique(sections).map((row) => ({ id: row.id, name: row.attributes.name, position: row.attributes.position, created_at: page.attributes.created_at, components: components.filter((component) => component.attributes.status_page_section_id === row.id).map((component) => component.id) }));
  data.components = unique(components).map((row) => {
    if (row.attributes.status_page_section_id && !sectionIds.has(row.attributes.status_page_section_id)) throw new Error(`Better Stack component ${row.id}: its section is missing.`);
    return { id: row.id, name: row.attributes.public_name, description: row.attributes.explanation, position: row.attributes.position, group_id: row.attributes.status_page_section_id, status: state(row.attributes.status) as SourceData["components"][number]["status"], created_at: page.attributes.created_at };
  });
  for (const report of unique(reports)) {
    const a = report.attributes;
    state(a.aggregate_state);
    const maintenance = a.report_type === "maintenance";
    const timeline = [...(updates.get(report.id) ?? [])].sort((x, y) => Date.parse(x.attributes.published_at) - Date.parse(y.attributes.published_at) || x.id.localeCompare(y.id));
    const affectedIds = new Set([...a.affected_resources.map((row) => row.status_page_resource_id), ...timeline.flatMap((row) => row.attributes.affected_resources.map((affected) => affected.status_page_resource_id))]);
    if ([...affectedIds].some((id) => !componentIds.has(id))) throw new Error(`Better Stack report ${report.id}: an affected displayed resource is missing.`);
    a.affected_resources.forEach((row) => state(row.status));
    const normalized: SourceIncident = {
      id: report.id, name: a.title, created_at: a.starts_at, status: maintenance ? "scheduled" : a.ends_at ? "resolved" : "investigating",
      resolved_at: a.ends_at, ...(maintenance ? { scheduled_for: a.starts_at, scheduled_until: a.ends_at, impact: "maintenance" } : { impact: a.aggregate_state.toLowerCase() === "downtime" ? "critical" : "minor" }),
      components: [...affectedIds].map((id) => ({ id })),
      incident_updates: timeline.map((row, index) => ({
        id: row.id, body: row.attributes.message, created_at: row.attributes.published_at,
        status: maintenance ? "in_progress" : (row.attributes.affected_resources.length > 0 && row.attributes.affected_resources.every((affected) => ["resolved", "operational"].includes(affected.status.toLowerCase()))) || (Boolean(a.ends_at) && index === timeline.length - 1) ? "resolved" : "investigating",
        affected_components: row.attributes.affected_resources.map((affected) => ({ code: affected.status_page_resource_id, new_status: state(affected.status) as NonNullable<SourceIncident["incident_updates"][number]["affected_components"]>[number]["new_status"] })),
      })),
    };
    (maintenance ? data.maintenance : data.incidents).push(normalized);
    accounting.push({ kind: maintenance ? "maintenance" : "incident", sourceId: report.id, name: a.title, outcome: "changed", reason: maintenance ? "All original maintenance messages and publication times are retained; Lamp window state is projected from start and end times, without replaying notices." : "Better Stack has no investigation lifecycle: Lamp projects Investigating for affected updates and Resolved for all-resolved updates or the final update of an ended report. Original messages and times are retained; component history follows the affected states until the report ends." });
  }
  for (const row of unique(subscribers)) {
    const a = row.attributes;
    let reason = "";
    const channel = a.channel ?? a.mode;
    const evidence = { ...row, ...a };
    const unsupportedDestination = ["phone", "phone_number", "sms", "slack", "slack_channel", "slack_webhook", "webhook", "webhook_url", "webhook_endpoint", "endpoint_url"].find(key => {
      const value = evidence[key]; return value !== undefined && value !== null && value !== false && value !== "" && (!Array.isArray(value) || value.length > 0);
    });
    if (channel !== undefined && channel !== "email") reason = `Unsupported Better Stack subscriber channel: ${String(channel)}. Only confirmed email subscriptions can move.`;
    else if (unsupportedDestination) reason = `Unsupported source destination evidence (${unsupportedDestination}); only confirmed email subscriptions can move.`;
    else if (a.unsubscribed_at || a.unsubscribed === true || a.status === "unsubscribed") reason = "Unsubscribed at the source; no invitation will be sent.";
    else if (!a.confirmed_at || !sourceTime.safeParse(a.confirmed_at).success) reason = "Missing or invalid source confirmation; no invitation will be sent.";
    else if (!Array.isArray(a.status_page_resource_ids)) reason = "Missing component preferences; the subscription cannot safely be broadened to all components.";
    else if (a.status_page_resource_ids.some((id) => !componentIds.has(id))) reason = "An explicitly selected displayed resource is missing; the subscription cannot safely be broadened.";
    if (reason) accounting.push({ kind: "subscriber", sourceId: row.id, name: "Email subscriber", outcome: "skipped", reason });
    else data.subscribers.push({ id: row.id, mode: "email", email: a.email, components: a.status_page_resource_ids, created_at: a.created_at });
  }
  return { data, accounting };
}
