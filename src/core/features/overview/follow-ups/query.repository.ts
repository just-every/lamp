import { incidentFollowUpsSql } from "./incident.repository";
import { maintenanceFollowUpsSql } from "./maintenance.repository";
import { reportCandidatesSql, reportFollowUpsSql } from "./report.repository";
import { importFollowUpsSql } from "./import.repository";
import { notificationFollowUpsSql } from "./notification.repository";
import { channelFollowUpsSql } from "./channel.repository";

// D1 bounds compound SELECTs. Each carrier group stays below that bound; list
// reads all groups in one transactional batch with one shared clock value.
function query(sql: string) {
  return `WITH follow_up_clock(now) AS (SELECT ?),
    follow_up_reports AS (${reportCandidatesSql}), follow_ups AS (${sql})`;
}
const incident = query(incidentFollowUpsSql);
const maintenance = query(maintenanceFollowUpsSql);
const report = query(reportFollowUpsSql);
const invitation = query(importFollowUpsSql);
const notification = query(notificationFollowUpsSql);
const channel = query(channelFollowUpsSql);
export const followUpsQueries = [incident, maintenance, report, invitation, notification, channel];
const queriesByKind: Record<string, string> = {
  "next-update": incident, "scheduled-publication": incident,
  "maintenance-start": maintenance, "maintenance-end": maintenance,
  "maintenance-reminder": maintenance, "maintenance-overrun": maintenance,
  report, "report-reminder": report, "imported-invitation": invitation,
  "notification-dispatch": notification, "notification-delivery": notification,
  "channel-notification": channel,
};

/** Mutations project only the current carrier, then match its full bound id. */
export function followUpsQueryFor(id: string): string | null {
  return Object.hasOwn(queriesByKind, id.split(":", 1)[0]) ? queriesByKind[id.split(":", 1)[0]] : null;
}
