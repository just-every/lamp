import { teamsAdaptiveCard } from '../subscribers/teams';
import { renderNotificationUpdate } from '../../shared/update-renderer';
import { parsePublishedComponentChanges } from '../../shared/incident-component-changes';
import { impactLabel } from '../../shared/incident-impact';
import { formatTime } from '../public-snapshot/format';
import type { DispatchableDelivery } from './repository';

export function renderSubscriberTeamsMessage(delivery: DispatchableDelivery, origin: string, links: { manage: string; unsubscribe: string }) {
  const time = (value: string) => formatTime(value, delivery.timezone ?? 'UTC');
  let lines: string[], statusUrl = new URL('/', origin).href;
  if (delivery.incidentUpdateId) {
    if (!delivery.incidentReference || !delivery.incidentTitle || !delivery.lifecycle || delivery.affectedAudience === null || delivery.customerImpact === null) throw new Error('Teams incident content is unavailable.');
    const update = renderNotificationUpdate({ incidentImpact: delivery.incidentImpact, incidentReference: delivery.incidentReference, incidentTitle: delivery.incidentTitle, lifecycle: delivery.lifecycle,
      affectedAudience: delivery.affectedAudience, customerImpact: delivery.customerImpact, whatStillWorks: delivery.whatStillWorks ?? '', details: delivery.details ?? '',
      nextUpdateAt: delivery.nextUpdateAt, nextUpdateDisplay: delivery.nextUpdateAt ? time(delivery.nextUpdateAt) : null, componentChanges: parsePublishedComponentChanges(delivery.componentChangesJson) });
    lines = [update.public.heading, `Status: ${update.public.lifecycle}`, ...update.public.fields.map(field => `${field.label}: ${field.value}`)];
    statusUrl = new URL(`/incidents/${encodeURIComponent(delivery.incidentReference)}`, origin).href;
  } else if (delivery.incidentReportId) {
    if (!delivery.incidentReference || !delivery.incidentTitle) throw new Error('Teams report content is unavailable.');
    lines = [`${delivery.incidentReference}: ${delivery.incidentTitle}`, 'Post-incident report', ...(delivery.incidentImpact === null ? [] : [`Incident impact: ${impactLabel(delivery.incidentImpact)}`]),
      ...[['Summary', delivery.reportSummary], ['Timeline', delivery.reportTimeline], ['Cause', delivery.reportCause], ['Remediation', delivery.reportRemediation]].flatMap(([label, value]) => value ? [`${label}: ${value}`] : [])];
    statusUrl = new URL(`/incidents/${encodeURIComponent(delivery.incidentReference)}`, origin).href;
  } else {
    if (!delivery.maintenanceReference || !delivery.maintenanceTitle || !delivery.maintenanceState || !delivery.maintenanceNoticeKind) throw new Error('Teams maintenance content is unavailable.');
    lines = [`${delivery.maintenanceReference}: ${delivery.maintenanceTitle}`, `Status: ${delivery.maintenanceState}`, `Notice: ${delivery.maintenanceNoticeKind}`,
      ...(delivery.maintenanceStartsAt ? [`Start: ${time(delivery.maintenanceStartsAt)}`] : []), ...(delivery.maintenanceEndsAt ? [`End: ${time(delivery.maintenanceEndsAt)}`] : []), ...(delivery.maintenanceNoticeBody ? [delivery.maintenanceNoticeBody] : [])];
  }
  return teamsAdaptiveCard(lines, [{ title: 'Open status update', url: statusUrl }, { title: 'Manage subscription', url: new URL(`/manage/${encodeURIComponent(links.manage)}`, origin).href }, { title: 'Unsubscribe', url: new URL(`/unsubscribe/${encodeURIComponent(links.unsubscribe)}`, origin).href }]);
}
