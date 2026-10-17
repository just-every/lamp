import { MaintenanceComposer } from "./maintenance-composer";
import { useMemo, useRef, useState } from "react";

import type { ComponentsService } from "../../components";
import type { MaintenanceService } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { LoadingState, useOperatorTime, FormError } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";

import { usePageTimezone, toPageDateTime } from "../../../app/client/ui/timezone";
import { windowInstant } from "./window-time";

type MaintenanceResponse = { maintenance: Awaited<ReturnType<MaintenanceService["list"]>> };
type ComponentsResponse = { components: Awaited<ReturnType<ComponentsService["list"]>> };


export function MaintenancePage() {
  const maintenance = useAppData<MaintenanceResponse>("/api/app/maintenance");
  const components = useAppData<ComponentsResponse>("/api/app/components");
  const [error, setError] = useState<string | null>(null);
  const visible = useMemo(() => components.data?.components.filter((component) => !component.internal) ?? [], [components.data]);
  if (maintenance.loading || components.loading) return <LoadingState />;
  if (maintenance.error || components.error) return <ErrorState onRetry={() => window.location.reload()}>{maintenance.error ?? components.error}</ErrorState>;
  if (!maintenance.data) return null;
  return <div className="page-stack"><section className="page-title-row"><div><p className="eyebrow">Scheduled work</p><h1>Maintenance</h1><p>Schedule a window once; its public notices and affected services follow the recorded lifecycle.</p></div></section>{error ? <FormError>{error}</FormError> : null}<div className="maintenance-workspace">
    <section className="data-card maintenance-record-card"><div className="card-heading"><div><p className="card-kicker">Persisted windows</p><h2>Maintenance record</h2></div><span className="count-label">{maintenance.data.maintenance.length} recorded</span></div>{maintenance.data.maintenance.length ? <div className="maintenance-list">{maintenance.data.maintenance.map((item) => <MaintenanceRow key={`${item.id}:${item.updatedAt}`} item={item} refresh={maintenance.refresh} onError={setError} />)}</div> : <EmptyState>No maintenance windows are recorded.</EmptyState>}</section>
    <MaintenanceComposer components={visible} refresh={maintenance.refresh} />
  </div></div>;
}

function MaintenanceRow({ item, refresh, onError }: { item: NonNullable<MaintenanceResponse["maintenance"]>[number]; refresh: () => void; onError: (error: string | null) => void }) {
  const formatOperatorTime = useOperatorTime();
  const timezone = usePageTimezone();
  const localDate = (iso: string) => toPageDateTime(iso, timezone);
  const datesDisclosure = useRef<HTMLDetailsElement>(null);
  const [startsAt, setStartsAt] = useState(localDate(item.startsAt)); const [endsAt, setEndsAt] = useState(localDate(item.endsAt)); const [saving, setSaving] = useState(false);
  const inProgress = item.state === "In progress" || item.state === "Verifying";
  const canExtend = inProgress && (() => { try { const nextEnd = windowInstant(endsAt, item.endsAt, timezone); return nextEnd !== null && Date.parse(nextEnd) > Date.parse(item.endsAt); } catch { return false; } })();
  const reschedule = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); onError(null); try { const nextStart = inProgress ? item.startsAt : windowInstant(startsAt, item.startsAt, timezone); const nextEnd = windowInstant(endsAt, item.endsAt, timezone); await appApi(`/api/app/maintenance/${item.id}/window`, { method: "PUT", body: JSON.stringify({ startsAt: nextStart, endsAt: nextEnd }) }); refresh(); } catch (cause) { onError(cause instanceof Error ? cause.message : "Maintenance window could not be changed."); } finally { setSaving(false); } };
  const resetDates = () => { setStartsAt(localDate(item.startsAt)); setEndsAt(localDate(item.endsAt)); if (datesDisclosure.current) { datesDisclosure.current.open = false; datesDisclosure.current.querySelector("summary")?.focus(); } };
  const cancel = async () => { setSaving(true); onError(null); try { await appApi(`/api/app/maintenance/${item.id}/cancel`, { method: "POST" }); refresh(); } catch (cause) { onError(cause instanceof Error ? cause.message : "Maintenance could not be cancelled."); } finally { setSaving(false); } };
  const complete = async () => { setSaving(true); onError(null); try { await appApi(`/api/app/maintenance/${item.id}/complete`, { method: "POST" }); refresh(); } catch (cause) { onError(cause instanceof Error ? cause.message : "Maintenance could not be completed."); } finally { setSaving(false); } };
  return <article className="maintenance-row"><div><span className="record-ref">{item.reference}</span><h3>{item.title}</h3><p>{formatOperatorTime(item.startsAt)} – {formatOperatorTime(item.endsAt)}</p><p>{item.components.map((component) => component.componentName).join(", ") || "No components recorded"}</p>{item.overrunning ? <p className="overrun-note">Running longer than planned since {formatOperatorTime(item.endsAt)}.</p> : null}</div><div className="maintenance-actions"><span className={`state-pill state-${item.state.toLowerCase().replaceAll(" ", "-")}`}>{item.state}</span>{item.state === "Scheduled" ? <><details className="maintenance-date-editor" ref={datesDisclosure}><summary>Change dates</summary><form className="row-window" onSubmit={reschedule}><p>Times in {timezone}.</p><label className="form-label">New start<input aria-label={`${item.reference} start`} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="form-label">New end<input aria-label={`${item.reference} end`} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label><div className="form-actions"><Button type="button" variant="secondary" disabled={saving} onClick={resetDates}>Cancel changes</Button><Button type="submit" variant="secondary" disabled={saving}>Reschedule</Button></div></form></details><Button type="button" variant="secondary" disabled={saving} onClick={cancel}>Cancel maintenance</Button></> : null}{inProgress ? <><details className="maintenance-date-editor" ref={datesDisclosure}><summary>Extend window</summary><form className="row-window" onSubmit={reschedule}><p>Times in {timezone}. The recorded start stays the same.</p><label className="form-label">New end<input aria-label={`${item.reference} end`} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label><div className="form-actions"><Button type="button" variant="secondary" disabled={saving} onClick={resetDates}>Cancel changes</Button><Button type="submit" variant="secondary" disabled={saving || !canExtend}>Extend window</Button></div></form></details><Button type="button" variant="secondary" disabled={saving} onClick={complete}>Complete maintenance</Button></> : null}</div>{item.state !== "Cancelled" && <details style={{width:"100%",minWidth:0}}><summary style={{minHeight:44}}>Write update</summary><MaintenanceComposer item={item} components={[]} refresh={refresh} /></details>}{item.notices.length > 0 && <details><summary style={{minHeight:44}}>Published timeline ({item.notices.length})</summary>{item.notices.map(notice=><section key={notice.id}><strong>{notice.kind}</strong><time>{formatOperatorTime(notice.publishedAt)}</time>{notice.correctsNoticeId&&<p>Correction to {notice.correctsNoticeId}</p>}<p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{notice.body}</p></section>)}</details>}{item.importedUpdates?.length > 0 && <details><summary>{item.importedUpdates.length} imported updates</summary>{item.importedUpdates.map(update => <section key={update.id}>{update.sourceStatus&&<strong>{update.sourceStatus}</strong>}<time dateTime={update.publishedAt}>{new Date(update.publishedAt).toLocaleString(undefined, { timeZone: timezone })}</time><p>{update.body}</p></section>)}</details>}</article>;
}
