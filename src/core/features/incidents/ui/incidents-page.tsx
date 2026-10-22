import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { IncidentsService } from "../service";
import { NewIncidentPage } from "./new-incident-page";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { LoadingState, useOperatorTime } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";
import { useAppData } from "../../../app/client/ui/api";
import { UpdateDueNotice, updateDueLabel, useCommittedTime } from "./update-due-notice";

type IncidentsResponse = { incidents: Awaited<ReturnType<IncidentsService["list"]>> };

export function IncidentsPage() {
  const { data, error, loading } = useAppData<IncidentsResponse>("/api/app/incidents");
  const createRequested = useRouterState({ select: state => state.location.hash === "new" });
  const navigate = useNavigate();
  // Older links ask for the create form with #new; it is its own screen now.
  useEffect(() => { if (createRequested) void navigate({ to: "/app/incidents/new", replace: true }); }, [createRequested, navigate]);
  const [dismissedEmptyCreation, setDismissedEmptyCreation] = useState(false);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;
  // An empty list opens the create form, not an empty table.
  if (!data.incidents.length && !dismissedEmptyCreation && !createRequested) return <NewIncidentPage onClose={() => setDismissedEmptyCreation(true)} />;
  const active = data.incidents.filter((incident) => incident.lifecycle !== "Resolved");
  const resolved = data.incidents.filter((incident) => incident.lifecycle === "Resolved");

  return <div className="page-stack">
    <section className="page-title-row"><div><h1>Incidents</h1><p>Tell customers what’s happening.</p></div><Button asChild><Link to="/app/incidents/new">New incident</Link></Button></section>
    <UpdateDueNotice incidents={active} />
    <section className="data-card incident-list-card">
      <div className="card-heading"><div><p className="card-kicker">Active</p><h2>Current incidents</h2></div><span className="count-label">{active.length} total</span></div>
      {active.length ? <div className="record-list">{active.map((incident) => <IncidentRow key={incident.id} incident={incident} />)}</div> : <EmptyState>No active incidents.</EmptyState>}
    </section>
    <section className="data-card incident-list-card">
      <div className="card-heading"><div><h2>Resolved incidents</h2></div><span className="count-label">{resolved.length} total</span></div>
      {resolved.length ? <div className="record-list">{resolved.map((incident) => <IncidentRow key={incident.id} incident={incident} />)}</div> : <EmptyState>No resolved incidents.</EmptyState>}
    </section>
  </div>;
}

function IncidentRow({ incident }: { incident: IncidentsResponse["incidents"][number] }) {
  const formatOperatorTime = useOperatorTime();
  const committedTime = useCommittedTime();
  const dueLabel = updateDueLabel(incident, committedTime);
  return <Link className={`incident-list-row${incident.overdue ? " live-block" : ""}`} to="/app/incidents/$incidentId" params={{ incidentId: incident.id }}>
    <span className="record-ref">{incident.reference}</span>
    <span className="incident-row-content"><strong>{incident.title}</strong><small>Opened {formatOperatorTime(incident.openedAt)}{incident.impact ? ` · ${incident.impact}` : " · No component impact"}</small></span>
    <span className="incident-row-state"><span className={`state-pill state-${incident.lifecycle.toLowerCase()}`}>{incident.updates.length ? incident.lifecycle : "Not published"}</span>{dueLabel && <small className="overdue-note">{dueLabel}</small>}</span>
    <Icon className="row-chevron" name="arrow" width={18} height={18} />
  </Link>;
}
