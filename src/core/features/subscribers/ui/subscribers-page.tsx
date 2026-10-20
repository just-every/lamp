import { useState, type FormEvent } from "react";

import type { SubscribersService } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { ListPagination } from "../../../app/client/ui/pagination";
import { LoadingState, useOperatorTime, FormError } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";
import { SubscriberReporting } from "../../subscriber-reporting/ui/subscriber-reporting";

type SubscribersResponse = { subscribers: Awaited<ReturnType<SubscribersService["list"]>>; limit: number; offset: number; hasMore: boolean };

export function SubscribersPage() {
  const formatOperatorTime = useOperatorTime();
  const [offset, setOffset] = useState(0);
  const { data, error, loading, refresh } = useAppData<SubscribersResponse>(`/api/app/subscribers?limit=100&offset=${offset}`);
  const [destination, setDestination] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [reportRefreshKey, setReportRefreshKey] = useState(0);

  async function addWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMutationError(null);
    try {
      await appApi("/api/app/subscribers/webhook", { method: "POST", body: JSON.stringify({ destination, contactEmail, componentIds: [] }) });
      setDestination(""); setContactEmail(""); refresh(); setReportRefreshKey(current => current + 1);
    } catch (cause) { setMutationError(cause instanceof Error ? cause.message : "The webhook subscriber could not be saved."); }
    finally { setSaving(false); }
  }

  async function removeSubscriber(id: string, destination: string) {
    if (!window.confirm(`Remove ${destination}? This permanently deletes their destination and contact details. Only non-identifying delivery history is kept.`)) return;
    setSaving(true); setMutationError(null);
    try { await appApi(`/api/app/subscribers/${id}`, { method: "DELETE" }); refresh(); setReportRefreshKey(current => current + 1); }
    catch (cause) { setMutationError(cause instanceof Error ? cause.message : "The subscriber could not be removed."); }
    finally { setSaving(false); }
  }

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;
  return <div className="page-stack">
    <section className="page-title-row"><div><h1>Subscribers</h1><p>People and services that get your updates.</p></div></section>
    {mutationError && <FormError>{mutationError}</FormError>}
    <section className="data-card subscriber-table-card subscriber-directory-card">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Subscriber records">
        <table role="table">
          <thead role="rowgroup"><tr role="row"><th scope="col">Destination</th><th scope="col">Channel</th><th scope="col">State</th><th scope="col">Selection</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody role="rowgroup">{data.subscribers.map((subscriber) => <tr role="row" key={subscriber.id}>
            <td role="cell" data-label="Destination" className="subscriber-destination"><strong>{subscriber.destination}</strong>{subscriber.contactEmail && <small>Contact {subscriber.contactEmail}</small>}<ClientExtensionSlot id="subscriber.detail.after.v1" context={{ subscriber: { id: subscriber.id, channel: subscriber.channel, state: subscriber.state, destination: subscriber.destination } }} /></td>
            <td role="cell" data-label="Channel">{subscriber.channel}</td>
            <td role="cell" data-label="State"><div><span className={`state-pill state-${subscriber.state}`}>{subscriber.state}</span>{subscriber.deactivationReason && <small>{subscriber.deactivationReason}{subscriber.deactivatedAt ? ` · ${formatOperatorTime(subscriber.deactivatedAt)}` : ""}</small>}</div></td>
            <td role="cell" data-label="Selection">{subscriber.selectionMode === "all" ? "All components" : `${subscriber.componentSelections.length} selected component${subscriber.componentSelections.length === 1 ? "" : "s"}`}</td>
            <td role="cell" data-label="Joined">{formatOperatorTime(subscriber.createdAt)}</td>
            <td role="cell" className="subscriber-actions">{subscriber.deactivationReason !== "deleted by operator" && <Button type="button" variant="secondary" className="table-action" disabled={saving} onClick={() => removeSubscriber(subscriber.id, subscriber.destination)}>Remove</Button>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {data.subscribers.length === 0 ? <EmptyState>No subscribers yet.</EmptyState> : <ListPagination label="Subscriber" offset={data.offset} shown={data.subscribers.length} hasMore={data.hasMore} onPrevious={() => setOffset((current) => Math.max(0, current - data.limit))} onNext={() => setOffset((current) => current + data.limit)} />}
    </section>
    <section className="limit-note"><Icon name="warning" width={17} height={17} />Every subscriber is available through these pages. Removing a subscriber deletes their destination and keeps only non-identifying delivery history.</section>
    <section className="data-card"><h2>Email unsubscribe requests</h2><p>Monitor your From mailbox. When someone emails an unsubscribe request, find their destination above and choose Remove. One-click unsubscribe from a notification is processed automatically.</p><p><a href="/docs/subscribers-and-notifications#process-email-unsubscribe-requests">Unsubscribe guide</a></p></section>
    <section className="data-card subscriber-webhook-card">
      <div><p className="card-kicker">Webhook subscriber</p><h2>Add an endpoint</h2><p>New endpoints follow every visible component.</p></div>
      <form onSubmit={addWebhook} className="subscriber-webhook-form"><label className="form-label">Endpoint URL<input required type="url" placeholder="https://hooks.example.com/lamp" value={destination} onChange={(event) => setDestination(event.target.value)} /></label><label className="form-label">Contact email<input required type="email" placeholder="ops@example.com" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label><Button disabled={saving}>{saving ? "Saving…" : "Add webhook"}</Button></form>
    </section>
    <details className="data-card subscriber-reporting-disclosure"><summary>Subscriber reporting</summary><SubscriberReporting refreshKey={reportRefreshKey} /></details>
  </div>;
}
