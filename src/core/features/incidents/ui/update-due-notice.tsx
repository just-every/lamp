import { Link } from "@tanstack/react-router";
import { Button } from "../../../app/client/ui/button";
import { usePageTimezone } from "../../../app/client/ui/timezone";

type DueIncident = { id: string; reference: string; title: string; updateDue: boolean; overdue: boolean; updateDueAt: string | null };

/** The committed time as HH:MM in the page's timezone (INCIDENT-010). */
export function useCommittedTime() {
  const timezone = usePageTimezone();
  return (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(iso));
}

export function updateDueLabel(incident: DueIncident, committedTime: (iso: string) => string) {
  if (!incident.updateDueAt) return null;
  return incident.overdue ? `Update overdue since ${committedTime(incident.updateDueAt)}` : `Update due at ${committedTime(incident.updateDueAt)}`;
}

/** Operator-only: the incidents whose next update is due or overdue, each with
 * one action that opens its composer and brief. Nothing here reaches customers. */
export function UpdateDueNotice({ incidents }: { incidents: DueIncident[] }) {
  const committedTime = useCommittedTime();
  const due = incidents.filter((incident) => incident.updateDueAt);
  if (!due.length) return null;
  return <section className="update-due-notice" aria-label="Updates due">
    {due.map((incident) => <div key={incident.id} className={`update-due-row${incident.overdue ? " is-overdue" : ""}`}>
      <span><strong>{updateDueLabel(incident, committedTime)}</strong><small>{incident.reference} · {incident.title}</small></span>
      <Button asChild><Link to="/app/incidents/$incidentId" params={{ incidentId: incident.id }} hash="composer-title">Write the update</Link></Button>
    </div>)}
  </section>;
}
