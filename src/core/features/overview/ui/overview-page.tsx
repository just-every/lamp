import { CommunicationPerformance } from "../../communication-performance/ui/communication-performance";
import { Link } from "@tanstack/react-router";

import { LiveStrip } from "./live-strip";
import type { OverviewService } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { LoadingState, useOperatorTime } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";
import { useAppData } from "../../../app/client/ui/api";
import { UpdateDueNotice, updateDueLabel, useCommittedTime } from "../../incidents/ui/update-due-notice";

type OverviewResponse = { overview: Awaited<ReturnType<OverviewService["get"]>> };

function StatePill({ state }: { state: string }) {
  return <span className={`state-pill state-${state.toLowerCase().replaceAll(" ", "-")}`}>{state}</span>;
}

// Only the worst impacts take the --down warning icon; every other row's icon stays ink-3.
function severeImpact(impact: string | null) {
  return impact === "Major outage" || impact === "Partially unavailable";
}

export function OverviewPage() {
  const formatOperatorTime = useOperatorTime();
  const committedTime = useCommittedTime();
  const { data, error, loading } = useAppData<OverviewResponse>("/api/app/overview");
  // A refresh keeps the page mounted: only the first load shows the loading state.
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;

  const { components, activeIncidents, maintenance } = data.overview;
  const stateCounts = components.reduce<Record<string, number>>((counts, component) => {
    counts[component.publicState] = (counts[component.publicState] ?? 0) + 1;
    return counts;
  }, {});
  const upcoming = maintenance.filter((item) => item.state === "Scheduled" || item.state === "In progress");

  return <div className="page-stack">
    <section className="page-title-row">
      <div><h1>Overview</h1></div>
      {components.length === 0 ? <Button asChild><Link to="/app/components">Add component <Icon name="arrow" width={16} height={16} /></Link></Button> : null}
    </section>

    <LiveStrip live={data.overview.live} />

    <UpdateDueNotice incidents={activeIncidents} />

    <section className="data-card" aria-label="Active incidents">
      <div className="card-heading"><h2>Active incidents</h2><Link className="text-link" to="/app/incidents">All incidents <Icon name="arrow" width={15} height={15} /></Link></div>
      {activeIncidents.length ? <div className="record-list">{activeIncidents.map((incident) => <Link key={incident.id} className={`record-row${incident.overdue ? " live-block" : ""}`} to="/app/incidents/$incidentId" params={{ incidentId: incident.id }}>
        <span className={`status-icon${severeImpact(incident.impact) ? " is-down" : ""}`}><Icon name="warning" width={20} height={20} /></span>
        <span><strong>{incident.reference} · {incident.title}</strong><small>Opened {formatOperatorTime(incident.openedAt)}{incident.impact ? ` · ${incident.impact}` : " · No component impact"}{updateDueLabel(incident, committedTime) ? <> · <span className="overdue-note">{updateDueLabel(incident, committedTime)}</span></> : null}</small></span>
        <StatePill state={incident.lifecycle} /><Icon name="arrow" width={18} height={18} />
      </Link>)}</div> : <EmptyState lamp={components.length === 0}>No active incidents.<br /><Button asChild className="overview-empty-action"><Link to="/app/incidents" hash="new">Report an incident</Link></Button></EmptyState>}
    </section>

    <section className="overview-grid" aria-label="Components and maintenance">
      <article className="data-card">
        <h2>Components</h2>
        {components.length ? <div className="state-summary-list">
          {Object.entries(stateCounts).map(([state, count]) => <div key={state}><StatePill state={state} /><strong>{count}</strong></div>)}
        </div> : <EmptyState icon="components">Add a public component to begin recording availability.</EmptyState>}
        {components.length ? <Link className="text-link" to="/app/components">Components and history <Icon name="arrow" width={15} height={15} /></Link> : null}
      </article>
      <article className="data-card">
        <h2>Upcoming maintenance</h2>
        {upcoming.length ? <><div className="compact-records">{upcoming.map((item) => <div key={item.id}><strong className="record-ref">{item.reference}</strong><span>{item.title}</span><small>{item.state} · {formatOperatorTime(item.startsAt)}</small></div>)}</div><Link className="text-link" to="/app/maintenance">View maintenance <Icon name="arrow" width={15} height={15} /></Link></> : <EmptyState icon="maintenance">No upcoming maintenance.<br /><Button asChild className="overview-empty-action"><Link to="/app/maintenance" hash="schedule-maintenance">Schedule maintenance</Link></Button></EmptyState>}
      </article>
    </section>
    <CommunicationPerformance />
    <ClientExtensionSlot id="overview.dashboard.after.v1" context={{}} />
  </div>;
}
