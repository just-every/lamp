import type { IncidentView } from "../service";
import { componentChangeLines } from "../renderer";
import { useOperatorTime } from "../../../app/client/ui/states";

/** What was already published, newest first. Nothing before the first update; its reach is a row of the panel below. */
export function IncidentTimeline({ incident }: { incident: IncidentView }) {
  const formatOperatorTime = useOperatorTime();
  if (!incident.updates.length) return null;
  return <section className="incident-record context-section" aria-labelledby="timeline-title"><h2 id="timeline-title">Timeline</h2>
    <ol className="timeline">{incident.updates.map((update) => <li key={update.id}><strong>{update.lifecycle}</strong><span>{formatOperatorTime(update.publishedAt)}</span><p>{update.customerImpact}</p>{update.automationAttribution ? <p>{update.automationAttribution}</p> : null}{update.automationReceiptId ? <p>Triggered by <a className="text-link" href={`/app/alerts?receipt=${update.automationReceiptId}#receipt-${update.automationReceiptId}`}>alert receipt {update.automationReceiptId}</a>.</p> : null}{componentChangeLines(update.componentChanges).map((line, index) => <p key={index}>{line}</p>)}</li>)}</ol>
  </section>;
}
