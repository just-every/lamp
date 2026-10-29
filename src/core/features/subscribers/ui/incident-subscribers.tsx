import { useState } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { ListPagination } from "../../../app/client/ui/pagination";
import { FormError } from "../../../app/client/ui/states";
import type { SubscriberView } from "../service";

type IncidentSubscribersResponse = { subscribers: SubscriberView[]; limit: number; offset: number; hasMore: boolean };

/** The incident's own audience, separate from component/page subscriptions. */
export function IncidentSubscribers({ incidentId }: { incidentId: string }) {
  const [offset, setOffset] = useState(0);
  const resource = useAppData<IncidentSubscribersResponse>(`/api/app/incidents/${incidentId}/subscribers?limit=100&offset=${offset}`);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove(subscriber: SubscriberView) {
    if (!window.confirm(`Remove ${subscriber.destination}? This permanently deletes their destination and contact details. Only non-identifying delivery history is kept.`)) return;
    setRemoving(true); setError(null);
    try { await appApi(`/api/app/subscribers/${subscriber.id}`, { method: "DELETE" }); resource.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The subscriber could not be removed."); }
    finally { setRemoving(false); }
  }
  return <section className="data-card subscriber-table-card subscriber-directory-card incident-subscribers-card" aria-labelledby="incident-subscribers-title">
    <h2 id="incident-subscribers-title">Incident subscribers</h2>
    {resource.data ? <>
      {resource.data.subscribers.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Incident subscriber records">
        <table role="table"><thead role="rowgroup"><tr role="row"><th scope="col">Destination</th><th scope="col">Channel</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody role="rowgroup">{resource.data.subscribers.map(subscriber => <tr role="row" key={subscriber.id}>
            <td role="cell" data-label="Destination" className="subscriber-destination"><strong>{subscriber.destination}</strong>{subscriber.contactEmail && <small>Contact {subscriber.contactEmail}</small>}</td>
            <td role="cell" data-label="Channel">{subscriber.channel}</td>
            <td role="cell" data-label="State"><span className={`state-pill state-${subscriber.state}`}>{subscriber.state}</span></td>
            <td role="cell" className="subscriber-actions"><Button type="button" variant="secondary" className="table-action" disabled={removing} onClick={() => void remove(subscriber)}>Remove</Button></td>
          </tr>)}</tbody>
        </table>
      </div> : <p>No incident subscribers yet.</p>}
      <ListPagination label="Incident subscriber" offset={resource.data.offset} shown={resource.data.subscribers.length} hasMore={resource.data.hasMore} onPrevious={() => setOffset(current => Math.max(0, current - resource.data!.limit))} onNext={() => setOffset(current => current + resource.data!.limit)} />
    </> : !resource.error ? <p>Loading incident subscribers…</p> : null}
    {(error || resource.error) && <FormError>{error || resource.error}</FormError>}
  </section>;
}
