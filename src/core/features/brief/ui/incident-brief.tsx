import { useEffect, useRef } from "react";
import type { IncidentBrief } from "../build";
import { useAppData } from "../../../app/client/ui/api";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";

/** The brief is built on the server from saved incident state; `revision`
 * changes when a saved draft or a publication may have answered a question. */
export function IncidentBriefPanel({ incidentId, revision }: { incidentId: string; revision: string | null }) {
  const formatOperatorTime = useOperatorTime();
  const { data, error, refresh } = useAppData<{ brief: IncidentBrief }>(`/api/app/incidents/${incidentId}/brief`);
  const seen = useRef(revision);
  useEffect(() => {
    if (revision === null || seen.current === revision) return;
    seen.current = revision;
    refresh();
  }, [revision, refresh]);
  if (error && !data) return <section className="incident-brief" aria-labelledby="brief-title"><h2 id="brief-title">Brief</h2><FormError>{error}</FormError></section>;
  if (!data) return null;
  const { brief } = data;
  const { alerts, updates, components } = brief.whatWeKnow;
  return <section className="incident-brief" aria-labelledby="brief-title">
    <h2 id="brief-title">Brief</h2>
    <div className="brief-columns">
      <div>
        <h3>What we know</h3>
        {alerts.length + updates.length + components.length ? <ul className="brief-list">
          {alerts.map((alert) => <li key={alert.ref} id={`brief-${alert.ref}`}><details><summary><b>{alert.ref}</b> {alert.state === "recovered" ? "Recovery" : "Alert"} from {alert.source} at {formatOperatorTime(alert.receivedAt)}{alert.title ? `: ${alert.title}` : ""}</summary>{alert.evidenceSummary && <p>{alert.evidenceSummary}</p>}<pre tabIndex={0} aria-label={`Alert ${alert.ref} payload`}>{JSON.stringify(alert.payload, null, 2)}</pre></details></li>)}
          {updates.map((update) => <li key={update.ref} id={`brief-${update.ref}`}><details><summary><b>{update.ref}</b> {update.lifecycle} update published {formatOperatorTime(update.publishedAt)}</summary><dl><dt>Who is affected</dt><dd>{update.affectedAudience}</dd><dt>Impact</dt><dd>{update.customerImpact}</dd>{update.whatStillWorks ? <><dt>What still works</dt><dd>{update.whatStillWorks}</dd></> : null}{update.details ? <><dt>Details</dt><dd>{update.details}</dd></> : null}{update.nextUpdateAt ? <><dt>Next update by</dt><dd>{formatOperatorTime(update.nextUpdateAt)}</dd></> : null}</dl></details></li>)}
          {components.map((component) => <li key={component.ref} id={`brief-${component.ref}`}><b>{component.ref}</b> {component.name}: {component.state} ({component.relationship.toLowerCase()})</li>)}
        </ul> : <p>Nothing is recorded for this incident yet.</p>}
      </div>
      <div>
        <h3>What we do not know yet</h3>
        {brief.whatWeDoNotKnowYet.length ? <ul className="brief-list brief-questions">
          {brief.whatWeDoNotKnowYet.map((question) => <li key={question.ref} id={`brief-${question.ref}`}>{question.question}{question.at ? <span> ({formatOperatorTime(question.at)})</span> : null}</li>)}
        </ul> : <p>No open questions from the saved incident.</p>}
      </div>
    </div>
    <details className="brief-disclosure"><summary>Exactly what the assistant is sent</summary><p>Internal notes are never part of it.</p><pre tabIndex={0} aria-label="Assistant input">{JSON.stringify(brief, null, 2)}</pre></details>
  </section>;
}
