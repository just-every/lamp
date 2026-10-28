import type { ReactNode } from "react";

import type { IncidentView } from "../service";
import { componentChangeLines } from "../renderer";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { useOperatorTime } from "../../../app/client/ui/states";
import { IncidentReach } from "../../communication-performance/ui/incident-reach";
import { IncidentBriefPanel } from "../../brief/ui/incident-brief";
import { ReportEditor } from "./incident-composer-tools";
import { IncidentSubscribers } from "../../subscribers/ui/incident-subscribers";

/** What was already published, newest first, with its reach once something was sent. Nothing before the first update. */
export function IncidentTimeline({ incident }: { incident: IncidentView }) {
  const formatOperatorTime = useOperatorTime();
  if (!incident.updates.length) return null;
  return <section className="incident-record context-section" aria-labelledby="timeline-title"><h2 id="timeline-title">Timeline</h2>
    <ol className="timeline">{incident.updates.map((update) => <li key={update.id}><strong>{update.lifecycle}</strong><span>{formatOperatorTime(update.publishedAt)}</span>{update.agentAttribution ? <p style={{overflowWrap:"anywhere"}}>Published by {update.agentAttribution.label}{update.agentAttribution.approvers.length ? ` · Approved by ${update.agentAttribution.approvers.map(person => person.name).join(", ")}` : ""}.</p> : null}<p>{update.customerImpact}</p>{componentChangeLines(update.componentChanges).map((line, index) => <p key={index}>{line}</p>)}</li>)}</ol>
    <IncidentReach incidentId={incident.id} updateIds={incident.updates.map(update => update.id)} />
  </section>;
}

/** Below the plate: the brief, the report once resolved, extensions, then the incident's private actions. */
export function IncidentExtras({ incident, briefRevision, children }: { incident: IncidentView; briefRevision: string | null; children: ReactNode }) {
  return <div className="incident-extras">
    <IncidentBriefPanel incidentId={incident.id} revision={briefRevision} />
    <IncidentSubscribers incidentId={incident.id} />
    {incident.lifecycle === "Resolved" ? <ReportEditor incidentId={incident.id} /> : null}
    <ClientExtensionSlot id="incident.sidebar.after.v1" context={{ incident: { id: incident.id, reference: incident.reference, lifecycle: incident.lifecycle } }} />
    {children}
  </div>;
}
