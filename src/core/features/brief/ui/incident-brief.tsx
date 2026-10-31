import { useEffect, useRef } from "react";
import type { IncidentBrief as Brief } from "../build";
import { useAppData } from "../../../app/client/ui/api";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";

/** The brief is built on the server from saved incident state; `revision` changes when a saved draft or a publication
 * may have answered a question. */
export function useIncidentBrief(incidentId: string, revision: string | null) {
  const { data, error, refresh } = useAppData<{ brief: Brief }>(`/api/app/incidents/${incidentId}/brief`);
  const seen = useRef(revision);
  useEffect(() => {
    if (revision === null || seen.current === revision) return;
    seen.current = revision;
    refresh();
  }, [revision, refresh]);
  return { brief: data?.brief ?? null, error };
}

/** The brief's one line: how many questions the saved incident leaves open. */
export function briefSummary(brief: Brief | null, error: string | null) {
  if (!brief) return error ? "Could not be read" : "Reading the brief…";
  const questions = brief.whatWeDoNotKnowYet.length;
  return questions ? `${questions} open ${questions === 1 ? "question" : "questions"}` : "No open questions";
}

/** DRAFT-004: the model-free facts and computed open questions, with exactly what a suggestion would send one click
 * away. Every fact and question keeps its stable #brief-<ref> anchor. */
export function IncidentBrief({ brief, error }: { brief: Brief | null; error: string | null }) {
  const formatOperatorTime = useOperatorTime();
  const { data: aiStatus } = useAppData<{ configured: boolean }>("/api/app/ai/status");
  if (!brief) return error ? <FormError>{error}</FormError> : null;
  const { alerts, updates, components } = brief.whatWeKnow;
  return <div className="incident-brief">
    {error ? <FormError>{error}</FormError> : null}
    <div className="brief-columns">
      <div>
        <h4>What we know</h4>
        {alerts.length + updates.length + components.length ? <ul className="brief-list">
          {alerts.map((alert) => <li key={alert.ref} id={`brief-${alert.ref}`}><details><summary style={{ minHeight: 44 }}><b>{alert.ref}</b> {alert.state === "recovered" ? "Recovery" : "Alert"} from {alert.source} at {formatOperatorTime(alert.receivedAt)}{alert.title ? `: ${alert.title}` : ""}</summary>{alert.evidenceSummary && <p>{alert.evidenceSummary}</p>}<pre tabIndex={0} aria-label={`Alert ${alert.ref} payload`}>{JSON.stringify(alert.payload, null, 2)}</pre></details></li>)}
          {updates.map((update) => <li key={update.ref} id={`brief-${update.ref}`}><details><summary style={{ minHeight: 44 }}><b>{update.ref}</b> {update.lifecycle} update published {formatOperatorTime(update.publishedAt)}</summary><dl><dt>Who is affected</dt><dd>{update.affectedAudience}</dd><dt>Impact</dt><dd>{update.customerImpact}</dd>{update.whatStillWorks ? <><dt>What still works</dt><dd>{update.whatStillWorks}</dd></> : null}{update.details ? <><dt>Details</dt><dd>{update.details}</dd></> : null}{update.nextUpdateAt ? <><dt>Next update by</dt><dd>{formatOperatorTime(update.nextUpdateAt)}</dd></> : null}</dl></details></li>)}
          {components.map((component) => <li key={component.ref} id={`brief-${component.ref}`}><b>{component.ref}</b> {component.name}: {component.state} ({component.relationship.toLowerCase()})</li>)}
        </ul> : <p>No details yet.</p>}
      </div>
      <div>
        <h4>What we do not know yet</h4>
        {brief.whatWeDoNotKnowYet.length ? <ul className="brief-list brief-questions">
          {brief.whatWeDoNotKnowYet.map((question) => <li key={question.ref} id={`brief-${question.ref}`}>{question.question}{question.at ? <span> ({formatOperatorTime(question.at)})</span> : null}</li>)}
        </ul> : <p>No open questions from the saved incident.</p>}
      </div>
    </div>
    {aiStatus?.configured && <details className="brief-disclosure"><summary>Exactly what the assistant is sent</summary><p>Internal notes are never part of it.</p><pre tabIndex={0} aria-label="Assistant input">{JSON.stringify(brief, null, 2)}</pre></details>}
  </div>;
}
