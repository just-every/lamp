import { useState } from "react";

import { DELIVERY_CHANNELS, DELIVERY_OUTCOMES, type DeliveryChannel, type DeliveryOutcome } from "../../../shared/domain";
import type { DeliveriesService } from "../service";
import { useAppData } from "../../../app/client/ui/api";
import { Icon } from "../../../app/client/ui/icon";
import { ListPagination } from "../../../app/client/ui/pagination";
import { LoadingState, useOperatorTime } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";

type DeliveriesResponse = {
  deliveries: Awaited<ReturnType<DeliveriesService["list"]>>;
  subscriptionMail: Awaited<ReturnType<DeliveriesService["listSubscriptionMail"]>>;
  limit: number;
  offset: number;
  hasMore: boolean;
  mail: { provider: "rer" | "resend" | "sendgrid"; local: boolean; receiptsConfigured: boolean };
};

const label = (value: string) => value === "email" ? "Email" : value === "webhook" ? "Webhook" : value === "suppressed" ? "Skipped" : value.charAt(0).toUpperCase() + value.slice(1);

const MAIL_KINDS = { confirmation: "Confirmation email", "already-subscribed": "Already subscribed", subscribed: "Subscribed notice" } as const;

// Confirmation and other subscription emails: sent once each, with no retries,
// so they sit apart from the notification records above.
function SubscriptionMail({ rows, providerName }: { rows: DeliveriesResponse["subscriptionMail"]; providerName: string }) {
  const formatOperatorTime = useOperatorTime();
  return <section className="data-card subscriber-table-card" aria-labelledby="subscription-mail-title">
    <h2 id="subscription-mail-title">Subscription emails</h2>
    <p>The latest confirmation and subscription emails, newest first.</p>
    {rows.length === 0 ? <EmptyState>No subscription email has been sent yet.</EmptyState> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Subscription emails">
      <table>
        <thead><tr><th scope="col">Destination</th><th scope="col">Email</th><th scope="col">Outcome</th><th scope="col">Sent</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td><strong>{row.destination}</strong><small>{row.subscriberState} subscriber</small></td>
          <td>{MAIL_KINDS[row.kind]}</td>
          <td><span className={`state-pill state-${row.outcome === "suppressed" ? "accepted" : row.outcome}`}>{row.outcome === "accepted" || row.outcome === "suppressed" ? `Accepted by ${providerName}` : "Failed"}</span></td>
          <td>{formatOperatorTime(row.sentAt)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}

export function DeliveriesPage() {
  const formatOperatorTime = useOperatorTime();
  const [channel, setChannel] = useState<DeliveryChannel | "">("");
  const [outcome, setOutcome] = useState<DeliveryOutcome | "">("");
  const [offset, setOffset] = useState(0);
  const search = new URLSearchParams({ limit: "100", offset: String(offset) });
  if (channel) search.set("channel", channel);
  if (outcome) search.set("outcome", outcome);
  const { data, error, loading } = useAppData<DeliveriesResponse>(`/api/app/deliveries?${search.toString()}`);
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;
  const csvSearch = new URLSearchParams();
  if (channel) csvSearch.set("channel", channel);
  if (outcome) csvSearch.set("outcome", outcome);
  const csvHref = `/api/app/deliveries.csv?${csvSearch.toString()}`;
  const providerName = data.mail.provider === "rer" ? "RER" : data.mail.provider === "sendgrid" ? "SendGrid" : "Resend";
  function resetFilters(next: () => void) { next(); setOffset(0); }
  return <div className="page-stack">
    <section className="page-title-row">
      <div><h1>Deliveries</h1><p>See what happened to your updates.</p></div>
      <a className="quiet-link delivery-export" href={csvHref}>Export CSV <Icon name="external" width={15} height={15} /></a>
    </section>
    {!data.mail.local && <section className="capability-note">
      <Icon name="warning" width={18} height={18} />
      <div>
        <strong>Delivery records are read-only.</strong>
        <p>{data.mail.receiptsConfigured
          ? "Queued email may already be accepted by the provider; the mail provider confirms delivery."
          : `Accepted by ${providerName} is the final email status available here because delivery confirmations are not connected. Inbox delivery is unconfirmed.`} Exports include all matching records. Opens are never tracked.</p>
      </div>
    </section>}
    <section className="data-card subscriber-table-card">
      <div className="list-controls">
        <label>Channel<select value={channel} onChange={(event) => resetFilters(() => setChannel(event.target.value as DeliveryChannel | ""))}><option value="">All channels</option>{DELIVERY_CHANNELS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
        <label>Outcome<select value={outcome} onChange={(event) => resetFilters(() => setOutcome(event.target.value as DeliveryOutcome | ""))}><option value="">All outcomes</option>{DELIVERY_OUTCOMES.map((value) => <option key={value} value={value}>{value === "queued" && channel !== "webhook" && !data.mail.local && !data.mail.receiptsConfigured ? "Queued / accepted" : label(value)}</option>)}</select></label>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Delivery records">
        <table>
          <thead><tr><th scope="col">Destination</th><th scope="col">Channel</th><th scope="col">Outcome</th><th scope="col">Queued</th><th scope="col">Outcome time</th></tr></thead>
          <tbody>{data.deliveries.map((delivery) => {
            const localAccepted = data.mail.local && delivery.channel === "email" && delivery.outcome === "suppressed";
            const acceptedWithoutReceipt = localAccepted || !data.mail.local && delivery.channel === "email" && delivery.outcome === "queued" && Boolean(delivery.providerAcceptedAt) && !data.mail.receiptsConfigured;
            return <tr key={delivery.id}>
              <td><strong>{delivery.destination}</strong><small>{delivery.subscriberState} subscriber</small>{delivery.maintenanceReference ? <small>{delivery.maintenanceReference}: {delivery.maintenanceTitle} · {delivery.maintenanceNoticeKind}</small> : null}{delivery.incidentReference ? <small>{delivery.incidentReference}: {delivery.incidentTitle} · {delivery.incidentLifecycle?.toLowerCase()}</small> : null}</td>
              <td>{label(delivery.channel)}</td>
              <td>
                <span className={`state-pill state-${acceptedWithoutReceipt ? "accepted" : delivery.outcome}`}>{acceptedWithoutReceipt ? `Accepted by ${providerName}` : label(delivery.outcome)}</span>
                {!data.mail.local && delivery.providerAcceptedAt ? <small>Provider accepted {formatOperatorTime(delivery.providerAcceptedAt)}{delivery.outcome === "queued" && data.mail.receiptsConfigured ? " · awaiting confirmation" : ""}</small> : null}
                {delivery.latestError && (delivery.outcome === "failed" || delivery.outcome === "queued") ? <small>{delivery.latestError}</small> : null}
              </td>
              <td>{formatOperatorTime(delivery.queuedAt)}</td>
              <td>{formatOperatorTime(localAccepted ? delivery.outcomeAt : acceptedWithoutReceipt ? delivery.providerAcceptedAt : delivery.outcomeAt)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {data.deliveries.length === 0 ? <EmptyState>No delivery records match these filters.</EmptyState> : <ListPagination label="Delivery" offset={data.offset} shown={data.deliveries.length} hasMore={data.hasMore} onPrevious={() => setOffset((current) => Math.max(0, current - data.limit))} onNext={() => setOffset((current) => current + data.limit)} />}
    </section>
    <SubscriptionMail rows={data.subscriptionMail} providerName={providerName} />
  </div>;
}
