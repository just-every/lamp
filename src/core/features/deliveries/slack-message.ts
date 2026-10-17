import { renderNotificationUpdate } from "../../shared/update-renderer";
import { impactLabel } from "../../shared/incident-impact";
import { renderLampSlackMessage } from "../channels/slack-message";
import { parsePublishedComponentChanges } from "../../shared/incident-component-changes";
import { formatTime } from "../public-snapshot/format";
import type { DispatchableDelivery } from "./repository";

/** Slack receives native message fields, never Lamp's generic webhook envelope. */
export function renderSubscriberSlackMessage(delivery: DispatchableDelivery, origin: string) {
  const time = (instant: string) => formatTime(instant, delivery.timezone ?? "UTC");
  if (delivery.incidentUpdateId) {
    if (delivery.incidentReference === null || delivery.incidentTitle === null || delivery.lifecycle === null || delivery.affectedAudience === null || delivery.customerImpact === null) throw new Error("Slack incident update content is unavailable.");
    const update = renderNotificationUpdate({
      incidentImpact: delivery.incidentImpact,
      incidentReference: delivery.incidentReference, incidentTitle: delivery.incidentTitle, lifecycle: delivery.lifecycle,
      affectedAudience: delivery.affectedAudience, customerImpact: delivery.customerImpact,
      whatStillWorks: delivery.whatStillWorks ?? "", details: delivery.details ?? "", nextUpdateAt: delivery.nextUpdateAt,
      nextUpdateDisplay: delivery.nextUpdateAt ? time(delivery.nextUpdateAt) : null,
      componentChanges: parsePublishedComponentChanges(delivery.componentChangesJson),
    });
    return renderLampSlackMessage(`${update.email.subject}${delivery.incidentImpact === null ? "" : ` · Incident impact: ${impactLabel(delivery.incidentImpact)}`}`, [
      update.public.heading, `Status: ${update.public.lifecycle}`,
      ...update.public.fields.map(field => `${field.label}: ${field.value}`),
      new URL(`/incidents/${encodeURIComponent(delivery.incidentReference)}`, origin).href,
    ]);
  }
  if (delivery.incidentReportId) {
    if (!delivery.incidentReference || !delivery.incidentTitle) throw new Error("Slack incident report content is unavailable.");
    const fields = [["Summary", delivery.reportSummary], ["Timeline", delivery.reportTimeline], ["Cause", delivery.reportCause], ["Remediation", delivery.reportRemediation]];
    return renderLampSlackMessage(`[${delivery.incidentReference}] Post-incident report${delivery.incidentImpact === null ? "" : ` · Incident impact: ${impactLabel(delivery.incidentImpact)}`}`, [
      `${delivery.incidentReference}: ${delivery.incidentTitle}`,
      ...(delivery.incidentImpact === null ? [] : [`Incident impact: ${impactLabel(delivery.incidentImpact)}`]),
      ...fields.flatMap(([label, value]) => value ? [`${label}: ${value}`] : []),
      new URL(`/incidents/${encodeURIComponent(delivery.incidentReference)}`, origin).href,
    ]);
  }
  if (!delivery.maintenanceReference || !delivery.maintenanceTitle || !delivery.maintenanceState || !delivery.maintenanceNoticeKind) throw new Error("Slack maintenance notice content is unavailable.");
  return renderLampSlackMessage(`[${delivery.maintenanceReference}] ${delivery.maintenanceNoticeKind}: ${delivery.maintenanceTitle}`, [
    `${delivery.maintenanceReference}: ${delivery.maintenanceTitle}`, `Status: ${delivery.maintenanceState}`, `Notice: ${delivery.maintenanceNoticeKind}`,
    ...(delivery.maintenanceStartsAt ? [`Start: ${time(delivery.maintenanceStartsAt)}`] : []),
    ...(delivery.maintenanceEndsAt ? [`End: ${time(delivery.maintenanceEndsAt)}`] : []),
    ...(delivery.maintenanceNoticeBody ? [delivery.maintenanceNoticeBody] : []),
    new URL("/", origin).href,
  ]);
}
