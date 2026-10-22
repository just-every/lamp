import { Link } from "@tanstack/react-router";

import type { IncidentView } from "../service";
import { usePageTimezone } from "../../../app/client/ui/timezone";
import { useCommittedTime } from "./update-due-notice";

const stateClass = (state: string) => `state-${state.toLowerCase().replaceAll(" ", "-")}`;

/** Reference, title and one line of facts: where the incident stands and when the next update is owed (INCIDENT-006, -010). */
export function IncidentHeader({ incident }: { incident: IncidentView }) {
  const timezone = usePageTimezone();
  const committedTime = useCommittedTime();
  const opened = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(incident.openedAt));
  const promised = incident.lifecycle === "Resolved" ? null : incident.updates[0]?.nextUpdateAt ?? null;
  return <header className="incident-heading">
    <Link className="back-link" to="/app/incidents">← Incidents</Link>
    <p className="eyebrow">{incident.reference}</p>
    <h1>{incident.title}</h1>
    <p className="incident-facts">
      {incident.updates.length ? <strong className={`fact-dot ${stateClass(incident.lifecycle)}`}>{incident.lifecycle}</strong> : <strong className="fact-dot">Not published yet</strong>}
      <span>Opened {opened}</span>
      {promised ? <span className={incident.overdue ? "overdue-note" : undefined}>{incident.overdue ? `Update overdue since ${committedTime(promised)}` : `Next update due ${committedTime(promised)}`}</span> : null}
    </p>
  </header>;
}
