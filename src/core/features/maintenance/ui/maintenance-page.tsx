import { useMemo, useRef, useState } from "react";

import type { ComponentsService } from "../../components";
import type { MaintenanceService } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { LoadingState, useOperatorTime, FormError } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";

import { usePageTimezone, toPageDateTime, fromPageDateTime } from "../../../app/client/ui/timezone";
import { windowInstant } from "./window-time";

type MaintenanceResponse = { maintenance: Awaited<ReturnType<MaintenanceService["list"]>> };
type ComponentsResponse = { components: Awaited<ReturnType<ComponentsService["list"]>> };


export function MaintenancePage() {
  const timezone = usePageTimezone();
  const maintenance = useAppData<MaintenanceResponse>("/api/app/maintenance");
  const components = useAppData<ComponentsResponse>("/api/app/components");
  const [title, setTitle] = useState(""); const [startsAt, setStartsAt] = useState(""); const [endsAt, setEndsAt] = useState(""); const [componentIds, setComponentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const visible = useMemo(() => components.data?.components.filter((component) => !component.internal) ?? [], [components.data]);
  if (maintenance.loading || components.loading) return <LoadingState />;
  if (maintenance.error || components.error) return <ErrorState onRetry={() => window.location.reload()}>{maintenance.error ?? components.error}</ErrorState>;
  if (!maintenance.data) return null;
  let startInstant: string | null = null, endInstant: string | null = null, timeError: string | null = null;
  try { startInstant = fromPageDateTime(startsAt, timezone); endInstant = fromPageDateTime(endsAt, timezone); } catch (cause) { timeError = (cause as Error).message; }
  const validWindow = Boolean(startInstant && endInstant && endInstant > startInstant);
  const schedule = async (event: React.FormEvent) => { event.preventDefault(); if (!validWindow) return; setSaving(true); setError(null); try { await appApi("/api/app/maintenance", { method: "POST", body: JSON.stringify({ title, startsAt: startInstant, endsAt: endInstant, componentIds }) }); setTitle(""); setStartsAt(""); setEndsAt(""); setComponentIds([]); maintenance.refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Maintenance could not be scheduled."); } finally { setSaving(false); } };
  return <div className="page-stack"><section className="page-title-row"><div><p className="eyebrow">Scheduled work</p><h1>Maintenance</h1><p>Schedule a window once; its public notices and affected services follow the recorded lifecycle.</p></div></section>{error ? <FormError>{error}</FormError> : null}<div className="maintenance-workspace">
    <section className="data-card maintenance-record-card"><div className="card-heading"><div><p className="card-kicker">Persisted windows</p><h2>Maintenance record</h2></div><span className="count-label">{maintenance.data.maintenance.length} recorded</span></div>{maintenance.data.maintenance.length ? <div className="maintenance-list">{maintenance.data.maintenance.map((item) => <MaintenanceRow key={`${item.id}:${item.startsAt}:${item.endsAt}`} item={item} refresh={maintenance.refresh} onError={setError} />)}</div> : <EmptyState>No maintenance windows are recorded.</EmptyState>}</section>
    <form className="data-card maintenance-schedule-card" onSubmit={schedule}><div className="card-heading"><div><p className="card-kicker">New window</p><h2>Schedule maintenance</h2></div></div><p className="schedule-copy">Components move to Under maintenance only when the recorded window begins.</p><label className="form-label">Title<input required maxLength={250} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Database maintenance" /></label><fieldset className="maintenance-components"><legend>Components</legend>{visible.map((component) => <label className="checkbox-label" key={component.id}><input type="checkbox" checked={componentIds.includes(component.id)} onChange={() => setComponentIds((current) => current.includes(component.id) ? current.filter((id) => id !== component.id) : [...current, component.id])} />{component.name}</label>)}</fieldset><p>Times in {timezone}.</p>{timeError ? <FormError>{timeError}</FormError> : null}<div className="schedule-window"><label className="form-label">Starts<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="form-label">Ends<input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div><p className={`window-validation ${validWindow ? "is-valid" : ""}`}>{validWindow ? "Window is valid: it will start and complete automatically." : "Choose an end time after the start time."}</p><div className="form-actions"><Button type="submit" disabled={saving || !validWindow || componentIds.length === 0}>{saving ? "Scheduling…" : "Schedule window"}</Button></div></form>
  </div></div>;
}

function MaintenanceRow({ item, refresh, onError }: { item: NonNullable<MaintenanceResponse["maintenance"]>[number]; refresh: () => void; onError: (error: string | null) => void }) {
  const formatOperatorTime = useOperatorTime();
  const timezone = usePageTimezone();
  const localDate = (iso: string) => toPageDateTime(iso, timezone);
  const datesDisclosure = useRef<HTMLDetailsElement>(null);
  const [startsAt, setStartsAt] = useState(localDate(item.startsAt)); const [endsAt, setEndsAt] = useState(localDate(item.endsAt)); const [saving, setSaving] = useState(false);
  const reschedule = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); onError(null); try { await appApi(`/api/app/maintenance/${item.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: windowInstant(startsAt, item.startsAt, timezone), endsAt: windowInstant(endsAt, item.endsAt, timezone) }) }); refresh(); } catch (cause) { onError(cause instanceof Error ? cause.message : "Maintenance could not be rescheduled."); } finally { setSaving(false); } };
  const cancel = async () => { setSaving(true); onError(null); try { await appApi(`/api/app/maintenance/${item.id}/cancel`, { method: "POST" }); refresh(); } catch (cause) { onError(cause instanceof Error ? cause.message : "Maintenance could not be cancelled."); } finally { setSaving(false); } };
  const complete = async () => { setSaving(true); onError(null); try { await appApi(`/api/app/maintenance/${item.id}/complete`, { method: "POST" }); refresh(); } catch (cause) { onError(cause instanceof Error ? cause.message : "Maintenance could not be completed."); } finally { setSaving(false); } };
  return <article className="maintenance-row"><div><span className="record-ref">{item.reference}</span><h3>{item.title}</h3><p>{formatOperatorTime(item.startsAt)} – {formatOperatorTime(item.endsAt)}</p><p>{item.components.map((component) => component.componentName).join(", ") || "No components recorded"}</p>{item.overrunning ? <p className="overrun-note">Running longer than planned since {formatOperatorTime(item.endsAt)}.</p> : null}</div><div className="maintenance-actions"><span className={`state-pill state-${item.state.toLowerCase().replaceAll(" ", "-")}`}>{item.state}</span>{item.state === "Scheduled" ? <><details className="maintenance-date-editor" ref={datesDisclosure}><summary>Change dates</summary><form className="row-window" onSubmit={reschedule}><p>Times in {timezone}.</p><label className="form-label">New start<input aria-label={`${item.reference} start`} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="form-label">New end<input aria-label={`${item.reference} end`} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label><div className="form-actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => { setStartsAt(localDate(item.startsAt)); setEndsAt(localDate(item.endsAt)); if (datesDisclosure.current) { datesDisclosure.current.open = false; datesDisclosure.current.querySelector("summary")?.focus(); } }}>Cancel changes</Button><Button type="submit" variant="secondary" disabled={saving}>Reschedule</Button></div></form></details><Button type="button" variant="secondary" disabled={saving} onClick={cancel}>Cancel maintenance</Button></> : null}{item.state === "In progress" ? <Button type="button" variant="secondary" disabled={saving} onClick={complete}>Complete maintenance</Button> : null}</div>{item.importedUpdates?.length > 0 && <details><summary>{item.importedUpdates.length} imported updates</summary>{item.importedUpdates.map(update => <section key={update.id}><time dateTime={update.publishedAt}>{new Date(update.publishedAt).toLocaleString(undefined, { timeZone: timezone })}</time><p>{update.body}</p></section>)}</details>}</article>;
}
