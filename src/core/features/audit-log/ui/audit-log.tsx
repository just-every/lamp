import { useState, type FormEvent } from "react";
import { useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { ListPagination } from "../../../app/client/ui/pagination";
import { useOperatorTime } from "../../../app/client/ui/states";
import type { AuditEntry } from "../repository";

type AuditResponse = { entries: AuditEntry[]; actions: string[]; actors: Array<{ id: string; name: string }>; limit: number; offset: number; hasMore: boolean };
function AuditRecords() {
  const time = useOperatorTime();
  const [actorId, setActor] = useState(""), [action, setAction] = useState(""), [from, setFrom] = useState(""), [until, setUntil] = useState("");
  const [selection, setSelection] = useState(""), [offset, setOffset] = useState(0);
  const { data, error, loading, refresh } = useAppData<AuditResponse>(`/api/app/audit-log?limit=50&offset=${offset}${selection}`);
  function apply(event: FormEvent) {
    event.preventDefault();
    const query = new URLSearchParams();
    if (actorId) query.set("actorId", actorId);
    if (action) query.set("action", action);
    if (from) query.set("from", new Date(`${from}T00:00:00Z`).toISOString());
    if (until) query.set("until", new Date(Date.parse(`${until}T00:00:00Z`) + 86400000).toISOString());
    setSelection(query.size ? `&${query}` : ""); setOffset(0);
  }
  return <div className="page-stack"><p>Who published, changed or removed something. Everyone can view this log. Times use your page timezone; date filters use UTC.</p><form className="settings-grid" onSubmit={apply}>
    <label className="form-label">Operator<select value={actorId} onChange={event => setActor(event.target.value)}><option value="">Everyone</option>{data?.actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
    <label className="form-label">Audit action<select value={action} onChange={event => setAction(event.target.value)}><option value="">Every action</option>{data?.actions.map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="form-label">From date (UTC)<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
    <label className="form-label">Through date (UTC)<input type="date" min={from || undefined} value={until} onChange={event => setUntil(event.target.value)} /></label>
    <div className="form-actions full-width"><Button>Apply filters</Button><Button type="button" variant="secondary" onClick={refresh}>Refresh audit log</Button><a className="text-link" href={`/api/app/audit-log?format=csv${selection}`}>Export matching audit CSV</a></div>
  </form>{error ? <p role="alert">{error}</p> : loading ? <p role="status">Loading audit entries…</p> : data ? <><div className="table-scroll" tabIndex={0} role="region" aria-label="Audit entries"><table role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Time</th><th role="columnheader" scope="col">Operator</th><th role="columnheader" scope="col">Action</th><th role="columnheader" scope="col">Record</th><th role="columnheader" scope="col">Reason</th></tr></thead><tbody role="rowgroup">{data.entries.map(entry => <tr role="row" key={entry.id}><td role="cell" data-label="Time">{time(entry.createdAt)}</td><td role="cell" data-label="Operator">{entry.actorName}<small>{entry.actorId ?? "Automated operation"}</small>{entry.approvedBy ? <small>Approved by {entry.approvedBy}</small> : null}{entry.nativeReviewedBy ? <small>Native review by {entry.nativeReviewedBy}</small> : null}</td><td role="cell" data-label="Action">{entry.action}</td><td role="cell" data-label="Record">{entry.entityType}<small>{entry.entityId}</small></td><td role="cell" data-label="Reason">{entry.reason ?? "—"}</td></tr>)}</tbody></table></div>{!data.entries.length && <p>No audit entries match these filters.</p>}<ListPagination label="Audit entry" offset={offset} shown={data.entries.length} hasMore={data.hasMore} onPrevious={() => setOffset(value => Math.max(0, value - data.limit))} onNext={() => setOffset(value => value + data.limit)} /></> : null}</div>;
}
export function AuditLog() {
  const [open, setOpen] = useState(false);
  return <section className="data-card" id="audit-log" aria-labelledby="audit-log-title"><p className="card-kicker">Accountability</p><h2 id="audit-log-title">Audit log</h2><Button type="button" variant="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Close audit log" : "Open audit log"}</Button>{open && <AuditRecords />}</section>;
}
