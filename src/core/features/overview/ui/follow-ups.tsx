import { useId, useState, type FormEvent } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";
import type { FollowUp } from "../follow-ups/types";

const endpoint = "/api/app/overview/follow-ups";

export function FollowUps() {
  const { data, error, loading, refresh } = useAppData<{ followUps: FollowUp[] }>(endpoint);
  return <section className="data-card" aria-label="Follow-ups">
    <div className="card-heading"><h2>Follow-ups</h2><Button type="button" variant="secondary" disabled={loading} onClick={refresh}>Refresh follow-ups</Button></div>
    <p>Work Lamp is carrying. Failed work stays here until completed or dismissed with a reason.</p>
    {error ? <FormError>{error}</FormError> : null}
    {loading && !data ? <p role="status">Loading follow-ups…</p> : null}
    {data ? data.followUps.length ? <div className="record-list">{data.followUps.map(item => <FollowUpRow key={item.id} item={item} onChanged={refresh} />)}</div> : <p>No outstanding follow-ups.</p> : null}
  </section>;
}

function FollowUpRow({ item, onChanged }: { item: FollowUp; onChanged: () => void }) {
  const formatTime = useOperatorTime();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function dismiss(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(null);
    try {
      await appApi(`${endpoint}/dismiss`, { method: "POST", body: JSON.stringify({ id: item.id, occurrence: item.occurrence, reason }) });
      setReason(""); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The follow-up could not be dismissed."); }
    finally { setPending(false); }
  }
  async function retry() {
    setPending(true); setError(null);
    try { await appApi(`${endpoint}/retry`, { method: "POST", body: JSON.stringify({ id: item.id, occurrence: item.occurrence }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The notification could not be queued."); }
    finally { setPending(false); onChanged(); }
  }
  return <article className="incident-operator-action" data-follow-up={item.id}>
    <a className="text-link" href={item.link}>{item.title}</a>
    <p>Owner: {item.owner?.displayName ?? "Unowned"} · Due <time dateTime={item.dueAt}>{formatTime(item.dueAt)}</time></p>
    <p>{item.stopCondition}</p>
    {item.failure ? <>
      <p className="overdue-note"><strong>Failed:</strong> {item.failure.message}</p>
      {item.kind === "notification-dispatch" ? <Button type="button" variant="secondary" disabled={pending} onClick={() => void retry()}>Retry notification dispatch</Button> : null}
      <details><summary>Dismiss failed follow-up</summary><form className="incident-note-form" onSubmit={dismiss}>
        <label className="form-label" htmlFor={reasonId}>Reason for dismissal</label>
        <textarea id={reasonId} value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} disabled={pending} />
        <Button type="submit" variant="secondary" disabled={pending || !reason.trim()}>Dismiss follow-up</Button>
      </form></details>
    </> : null}
    {error ? <FormError>{error}</FormError> : null}
  </article>;
}
