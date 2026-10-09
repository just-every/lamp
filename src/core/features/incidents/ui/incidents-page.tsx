import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import type { IncidentsService } from "../service";
import { IncidentCreatePanel } from "./incident-create-panel";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { EmptyState, ErrorState, LoadingState, formatOperatorTime } from "../../../app/client/ui/states";
import { useAppData } from "../../../app/client/ui/api";

type IncidentsResponse = { incidents: Awaited<ReturnType<IncidentsService["list"]>> };

export function IncidentsPage() {
  const { data, error, loading, refresh } = useAppData<IncidentsResponse>("/api/app/incidents");
  const [creating, setCreating] = useState(false);
  const [dismissedEmptyCreation, setDismissedEmptyCreation] = useState(false);
  const navigate = useNavigate();
  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;
  const active = data.incidents.filter((incident) => incident.lifecycle !== "Resolved");
  const resolved = data.incidents.filter((incident) => incident.lifecycle === "Resolved");

  const create = (incident: IncidentsResponse["incidents"][number]) => {
    refresh();
    void navigate({ to: "/app/incidents/$incidentId", params: { incidentId: incident.id } });
  };

  return <div className="page-stack">
    <section className="page-title-row"><div><p className="eyebrow">Incident communication desk</p><h1>Incidents</h1><p>Each published customer update is retained as an immutable record.</p></div><Button type="button" onClick={() => { setDismissedEmptyCreation(false); setCreating(true); }}>Create incident</Button></section>
    {creating || (!dismissedEmptyCreation && data.incidents.length === 0) ? <IncidentCreatePanel onCreated={create} onCancel={() => { setCreating(false); setDismissedEmptyCreation(true); }} /> : null}
    <section className="data-card incident-list-card">
      <div className="card-heading"><div><p className="card-kicker">Active</p><h2>Current incidents</h2></div><span className="count-label">{active.length} recorded</span></div>
      {active.length ? <div className="record-list">{active.map((incident) => <IncidentRow key={incident.id} incident={incident} />)}</div> : <EmptyState>No active incidents are recorded.</EmptyState>}
    </section>
    <section className="data-card incident-list-card">
      <div className="card-heading"><div><p className="card-kicker">Public record</p><h2>Resolved incidents</h2></div><span className="count-label">{resolved.length} recorded</span></div>
      {resolved.length ? <div className="record-list">{resolved.map((incident) => <IncidentRow key={incident.id} incident={incident} />)}</div> : <EmptyState>No resolved incidents are recorded.</EmptyState>}
    </section>
  </div>;
}

function IncidentRow({ incident }: { incident: IncidentsResponse["incidents"][number] }) {
  return <Link className="incident-list-row" to="/app/incidents/$incidentId" params={{ incidentId: incident.id }}>
    <span className="status-icon"><Icon name={incident.overdue ? "warning" : "incident"} width={19} height={19} /></span>
    <span className="incident-row-content"><strong>{incident.reference}</strong><span>{incident.title}</span><small>Opened {formatOperatorTime(incident.openedAt)}{incident.impact ? ` · ${incident.impact}` : " · No component impact"}</small></span>
    <span className="incident-row-state"><span className={`state-pill state-${incident.lifecycle.toLowerCase()}`}>{incident.lifecycle}</span>{incident.overdue && <small>Overdue</small>}</span>
    <Icon name="arrow" width={18} height={18} />
  </Link>;
}
