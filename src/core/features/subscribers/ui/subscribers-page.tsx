import { useState, type FormEvent } from "react";

import type { SubscribersService } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { ListPagination } from "../../../app/client/ui/pagination";
import { LoadingState, useOperatorTime, FormError } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";

type SubscribersResponse = { subscribers: Awaited<ReturnType<SubscribersService["list"]>>; limit: number; offset: number; hasMore: boolean };

export function SubscribersPage() {
  const formatOperatorTime = useOperatorTime();
  const [offset, setOffset] = useState(0);
  const { data, error, loading, refresh } = useAppData<SubscribersResponse>(`/api/app/subscribers?limit=100&offset=${offset}`);
  const [destination, setDestination] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function addWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMutationError(null);
    try {
      await appApi("/api/app/subscribers/webhook", { method: "POST", body: JSON.stringify({ destination, contactEmail, componentIds: [] }) });
      setDestination(""); setContactEmail(""); refresh();
    } catch (cause) { setMutationError(cause instanceof Error ? cause.message : "The webhook subscriber could not be saved."); }
    finally { setSaving(false); }
  }

  async function removeSubscriber(id: string) {
    setSaving(true); setMutationError(null);
    try { await appApi(`/api/app/subscribers/${id}`, { method: "DELETE" }); refresh(); }
    catch (cause) { setMutationError(cause instanceof Error ? cause.message : "The subscriber could not be removed."); }
    finally { setSaving(false); }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;
  return <div className="page-stack"><section className="page-title-row"><div><p className="eyebrow">Subscriber directory</p><h1>Subscribers</h1><p>Persisted subscriber destinations and their delivery eligibility.</p></div></section><section className="limit-note"><Icon name="warning" width={17} height={17} />Every subscriber is available through these pages. Removing a subscriber deletes their destination and keeps only non-identifying delivery history.</section><section className="data-card subscriber-webhook-card"><div><p className="card-kicker">Webhook subscriber</p><h2>Add an endpoint</h2><p>New endpoints follow every visible component.</p></div><form onSubmit={addWebhook} className="subscriber-webhook-form"><label className="form-label">Endpoint URL<input required type="url" placeholder="https://hooks.example.com/lamp" value={destination} onChange={(event) => setDestination(event.target.value)} /></label><label className="form-label">Contact email<input required type="email" placeholder="ops@example.com" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label><Button disabled={saving}>{saving ? "Saving…" : "Add webhook"}</Button></form></section>{mutationError && <FormError>{mutationError}</FormError>}<section className="data-card subscriber-table-card"><div className="table-scroll" tabIndex={0} role="region" aria-label="Subscriber records"><table><thead><tr><th scope="col">Destination</th><th scope="col">Channel</th><th scope="col">State</th><th scope="col">Selection</th><th scope="col">Recorded</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.subscribers.map((subscriber) => <tr key={subscriber.id}><td><strong>{subscriber.destination}</strong>{subscriber.contactEmail && <small>Contact {subscriber.contactEmail}</small>}<ClientExtensionSlot id="subscriber.detail.after.v1" context={{ subscriber: { id: subscriber.id, channel: subscriber.channel, state: subscriber.state, destination: subscriber.destination } }} /></td><td>{subscriber.channel}</td><td><span className={`state-pill state-${subscriber.state}`}>{subscriber.state}</span>{subscriber.deactivationReason && <small>{subscriber.deactivationReason}{subscriber.deactivatedAt ? ` · ${formatOperatorTime(subscriber.deactivatedAt)}` : ""}</small>}</td><td>{subscriber.selectionMode === "all" ? "All components" : `${subscriber.componentSelections.length} selected component${subscriber.componentSelections.length === 1 ? "" : "s"}`}</td><td>{formatOperatorTime(subscriber.createdAt)}</td><td><Button type="button" variant="secondary" className="table-action" disabled={saving} onClick={() => removeSubscriber(subscriber.id)}>Remove</Button></td></tr>)}</tbody></table></div>{data.subscribers.length === 0 ? <EmptyState>No subscribers are recorded.</EmptyState> : <ListPagination label="Subscriber" offset={data.offset} shown={data.subscribers.length} hasMore={data.hasMore} onPrevious={() => setOffset((current) => Math.max(0, current - data.limit))} onNext={() => setOffset((current) => current + data.limit)} />}</section></div>;
}
