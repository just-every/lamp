import { useState } from "react";

import { DELIVERY_CHANNELS, DELIVERY_OUTCOMES, type DeliveryChannel, type DeliveryOutcome } from "../../../shared/domain";
import type { DeliveriesService } from "../service";
import { useAppData } from "../../../app/client/ui/api";
import { Icon } from "../../../app/client/ui/icon";
import { ListPagination } from "../../../app/client/ui/pagination";
import { LoadingState, useOperatorTime } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";

type DeliveriesResponse = { deliveries: Awaited<ReturnType<DeliveriesService["list"]>>; limit: number; offset: number; hasMore: boolean };

export function DeliveriesPage() {
  const formatOperatorTime = useOperatorTime();
  const [channel, setChannel] = useState<DeliveryChannel | "">("");
  const [outcome, setOutcome] = useState<DeliveryOutcome | "">("");
  const [offset, setOffset] = useState(0);
  const search = new URLSearchParams({ limit: "100", offset: String(offset) });
  if (channel) search.set("channel", channel);
  if (outcome) search.set("outcome", outcome);
  const { data, error, loading } = useAppData<DeliveriesResponse>(`/api/app/deliveries?${search.toString()}`);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;
  const csvSearch = new URLSearchParams();
  if (channel) csvSearch.set("channel", channel);
  if (outcome) csvSearch.set("outcome", outcome);
  const csvHref = `/api/app/deliveries.csv?${csvSearch.toString()}`;
  function resetFilters(next: () => void) { next(); setOffset(0); }
  return <div className="page-stack"><section className="page-title-row"><div><p className="eyebrow">Notification audit</p><h1>Deliveries</h1><p>Persisted transport outcomes, never reader tracking.</p></div><a className="quiet-link delivery-export" href={csvHref}>Export CSV <Icon name="external" width={15} height={15} /></a></section><section className="capability-note"><Icon name="warning" width={18} height={18} /><div><strong>Delivery records are read-only.</strong><p>Outcomes are queued, delivered, bounced, complained, suppressed, or failed; Lamp never records an opened outcome. Queued email may already be accepted by the provider; only a signed receipt marks it delivered. CSV export includes every matching record.</p></div></section><section className="data-card subscriber-table-card"><div className="list-controls"><label>Channel<select value={channel} onChange={(event) => resetFilters(() => setChannel(event.target.value as DeliveryChannel | ""))}><option value="">All channels</option>{DELIVERY_CHANNELS.map((value) => <option key={value}>{value}</option>)}</select></label><label>Outcome<select value={outcome} onChange={(event) => resetFilters(() => setOutcome(event.target.value as DeliveryOutcome | ""))}><option value="">All outcomes</option>{DELIVERY_OUTCOMES.map((value) => <option key={value}>{value}</option>)}</select></label></div><div className="table-scroll" tabIndex={0} role="region" aria-label="Delivery records"><table><thead><tr><th scope="col">Destination</th><th scope="col">Channel</th><th scope="col">Outcome</th><th scope="col">Queued</th><th scope="col">Outcome time</th></tr></thead><tbody>{data.deliveries.map((delivery) => <tr key={delivery.id}><td><strong>{delivery.destination}</strong><small>{delivery.subscriberState} subscriber</small></td><td>{delivery.channel}</td><td><span className={`state-pill state-${delivery.outcome}`}>{delivery.outcome}</span>{delivery.providerAcceptedAt ? <small>Provider accepted {formatOperatorTime(delivery.providerAcceptedAt)}{delivery.outcome === "queued" ? " · awaiting delivery receipt" : ""}</small> : null}{delivery.latestError && (delivery.outcome === "failed" || delivery.outcome === "queued") ? <small>{delivery.latestError}</small> : null}</td><td>{formatOperatorTime(delivery.queuedAt)}</td><td>{formatOperatorTime(delivery.outcomeAt)}</td></tr>)}</tbody></table></div>{data.deliveries.length === 0 ? <EmptyState>No delivery records match these filters.</EmptyState> : <ListPagination label="Delivery" offset={data.offset} shown={data.deliveries.length} hasMore={data.hasMore} onPrevious={() => setOffset((current) => Math.max(0, current - data.limit))} onNext={() => setOffset((current) => current + data.limit)} />}</section></div>;
}
