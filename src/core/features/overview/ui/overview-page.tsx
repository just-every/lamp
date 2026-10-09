import { Link } from "@tanstack/react-router";

import type { OverviewService } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { EmptyState, ErrorState, LoadingState, formatOperatorTime } from "../../../app/client/ui/states";
import { useAppData } from "../../../app/client/ui/api";

type OverviewResponse = { overview: Awaited<ReturnType<OverviewService["get"]>> };

function StatePill({ state }: { state: string }) {
  return <span className={`state-pill state-${state.toLowerCase().replaceAll(" ", "-")}`}>{state}</span>;
}

export function OverviewPage() {
  const { data, error, loading } = useAppData<OverviewResponse>("/api/app/overview");
  if (loading) return <LoadingState />;
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
      <div><p className="eyebrow">Current status</p><h1>Overview</h1></div>
      {components.length === 0 ? <Button asChild><Link to="/app/components">Add component <Icon name="arrow" width={16} height={16} /></Link></Button> : null}
    </section>

    <section className="data-card" aria-label="Active incidents">
      <div className="card-heading"><h2>Active incidents</h2><Link className="text-link" to="/app/incidents">All incidents <Icon name="arrow" width={15} height={15} /></Link></div>
      {activeIncidents.length ? <div className="record-list">{activeIncidents.map((incident) => <Link key={incident.id} className="record-row" to="/app/incidents/$incidentId" params={{ incidentId: incident.id }}>
        <span className="status-icon"><Icon name={incident.overdue ? "warning" : "incident"} width={17} height={17} /></span>
        <span><strong>{incident.reference} · {incident.title}</strong><small>Opened {formatOperatorTime(incident.openedAt)}{incident.impact ? ` · ${incident.impact}` : " · No component impact"}{incident.overdue ? " · Next update overdue" : ""}</small></span>
        <StatePill state={incident.lifecycle} /><Icon name="arrow" width={16} height={16} />
      </Link>)}</div> : <EmptyState>No active incidents are recorded.</EmptyState>}
    </section>

    <section className="overview-grid" aria-label="Components and maintenance">
      <article className="data-card">
        <h2>Components</h2>
        {components.length ? <div className="state-summary-list">
          {Object.entries(stateCounts).map(([state, count]) => <div key={state}><StatePill state={state} /><strong>{count}</strong></div>)}
        </div> : <EmptyState>Add a public component to begin recording availability.</EmptyState>}
        {components.length ? <Link className="text-link" to="/app/components">Components and history <Icon name="arrow" width={15} height={15} /></Link> : null}
      </article>
      <article className="data-card">
        <h2>Upcoming maintenance</h2>
        {upcoming.length ? <div className="compact-records">{upcoming.map((item) => <div key={item.id}><strong>{item.reference}</strong><span>{item.title}</span><small>{item.state} · {formatOperatorTime(item.startsAt)}</small></div>)}</div> : <EmptyState>No upcoming maintenance.</EmptyState>}
        <Link className="text-link" to="/app/maintenance">View maintenance <Icon name="arrow" width={15} height={15} /></Link>
      </article>
    </section>
    <ClientExtensionSlot id="overview.dashboard.after.v1" context={{}} />
  </div>;
}
