import { useState } from "react";

import { DELIVERY_CHANNELS, DELIVERY_OUTCOMES, type DeliveryOutcome } from "../../../shared/domain";
import type { DeliveryLogChannel } from "../repository";
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
  mail: { provider: "rer" | "resend" | "sendgrid" | "mailgun" | "ses" | "postmark"; secondaryProvider:string|null; receiptProviders:Record<string,boolean>; local: boolean; receiptsConfigured: boolean };
  sms: { configured: boolean };
};

const label = (value: string) => value === "sms" ? "SMS" : value === "email" ? "Email" : value === "webhook" ? "Webhook" : value === "suppressed" ? "Skipped" : value.charAt(0).toUpperCase() + value.slice(1);

const providerNames:Record<string,string>={sendgrid:'SendGrid',resend:'Resend',mailgun:'Mailgun',ses:'Amazon SES',postmark:'Postmark',rer:'RER',twilio:'Twilio'};
const providerLabel=(value:string)=>providerNames[value]??value;
const nameList=(names:string[])=>names.length>1?`${names.slice(0,-1).join(", ")} and ${names.at(-1)}`:names[0]??"";

// One line, true for every channel the log holds: texts are named only when
// Twilio is configured, and each mail provider by whether its receipts are on.
function receiptNote(mail:DeliveriesResponse["mail"],smsConfigured:boolean) {
  const providers=Object.entries(mail.receiptProviders);
  const confirming=providers.filter(([,enabled])=>enabled).map(([provider])=>providerLabel(provider));
  const acceptanceOnly=providers.filter(([,enabled])=>!enabled).map(([provider])=>providerLabel(provider));
  const parts=[
    smsConfigured?`${providerLabel("twilio")} confirms texts`:"",
    confirming.length?`${nameList(confirming)} confirm${confirming.length>1?"":"s"} emails`:"",
    acceptanceOnly.length?`${nameList(acceptanceOnly)} report${acceptanceOnly.length>1?"":"s"} acceptance only`:"",
  ].filter(Boolean);
  return `${[parts.join("; "),"Opens are never tracked"].filter(Boolean).join(". ")}.`;
}

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
  const [channel, setChannel] = useState<DeliveryLogChannel | "">("");
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
  const providerName = data.mail.provider === "rer" ? "RER" : data.mail.provider === "sendgrid" ? "SendGrid" : data.mail.provider === "mailgun" ? "Mailgun" : data.mail.provider === "ses" ? "Amazon SES" : data.mail.provider === "postmark" ? "Postmark" : "Resend";
  const hasReceipts=Object.values(data.mail.receiptProviders).some(Boolean);
  function resetFilters(next: () => void) { next(); setOffset(0); }
  return <div className="page-stack agent-deliveries-page">
    <section className="page-title-row">
      <div><h1>Deliveries</h1><p>See what happened to your updates.</p></div>
      <a className="quiet-link delivery-export" href={csvHref}>Export CSV <Icon name="external" width={15} height={15} /></a>
    </section>
    {!data.mail.local && <section className="capability-note">
      <Icon name="warning" width={18} height={18} />
      <div>{receiptNote(data.mail, data.sms.configured)}</div>
    </section>}
    <section className="data-card subscriber-table-card subscriber-directory-card delivery-records-card">
      <div className="list-controls">
        <label>Channel<select aria-label="Channel" value={channel} onChange={(event) => resetFilters(() => setChannel(event.target.value as DeliveryLogChannel | ""))}><option value="">All channels</option>{[...DELIVERY_CHANNELS, "sms"].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
        <label>Outcome<select aria-label="Outcome" value={outcome} onChange={(event) => resetFilters(() => setOutcome(event.target.value as DeliveryOutcome | ""))}><option value="">All outcomes</option>{DELIVERY_OUTCOMES.map((value) => <option key={value} value={value}>{value === "queued" && channel !== "webhook" && !data.mail.local && !hasReceipts ? "Queued / accepted" : label(value)}</option>)}</select></label>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Delivery records">
        <table role="table">
          <thead role="rowgroup"><tr role="row"><th scope="col">Destination</th><th scope="col">Channel</th><th scope="col">Outcome</th><th scope="col">Queued</th><th scope="col">Outcome time</th></tr></thead>
          <tbody role="rowgroup">{data.deliveries.map((delivery) => {
            const localAccepted = data.mail.local && delivery.channel === "email" && delivery.outcome === "suppressed";
            const rowReceiptsConfigured=data.mail.receiptProviders[delivery.acceptingProvider??data.mail.provider]??false;
            const acceptedWithoutReceipt = localAccepted || !data.mail.local && delivery.channel === "email" && delivery.outcome === "queued" && Boolean(delivery.providerAcceptedAt) && !rowReceiptsConfigured;
            return <tr role="row" key={delivery.id}>
              <td role="cell" data-label="Destination" className="subscriber-destination"><strong>{delivery.destination}</strong><small>{delivery.subscriberState} subscriber</small>{delivery.agentLabel ? <small>Prepared by {delivery.agentLabel}</small> : null}{delivery.maintenanceReference ? <small>{delivery.maintenanceReference}: {delivery.maintenanceTitle} · {delivery.maintenanceNoticeKind}</small> : null}{delivery.incidentReference ? <small>{delivery.incidentReference}: {delivery.incidentTitle} · {delivery.incidentLifecycle?.toLowerCase()}</small> : null}</td>
              <td role="cell" data-label="Channel">{label(delivery.channel)}</td>
              <td role="cell" data-label="Outcome"><div>
                <span className={`state-pill state-${acceptedWithoutReceipt ? "accepted" : delivery.outcome}`} data-provider-outcome={delivery.providerOutcome ?? undefined}>{acceptedWithoutReceipt ? `Accepted by ${delivery.acceptingProvider ? providerLabel(delivery.acceptingProvider) : providerName}` : label(delivery.outcome)}</span>
                {delivery.providerOutcome === "undelivered" ? <small>Undelivered by carrier</small> : null}
                {!data.mail.local && delivery.providerAcceptedAt ? <small>{delivery.acceptingProvider ? `${providerLabel(delivery.acceptingProvider)} accepted` : "Provider accepted"} {formatOperatorTime(delivery.providerAcceptedAt)}{delivery.outcome === "queued" && rowReceiptsConfigured ? " · awaiting confirmation" : ""}</small> : null}
                {delivery.latestError && (delivery.outcome === "failed" || delivery.outcome === "queued") ? <small>{delivery.latestError}</small> : null}
              </div></td>
              <td role="cell" data-label="Queued">{formatOperatorTime(delivery.queuedAt)}</td>
              <td role="cell" data-label="Outcome time">{formatOperatorTime(localAccepted ? delivery.outcomeAt : acceptedWithoutReceipt ? delivery.providerAcceptedAt : delivery.outcomeAt)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {data.deliveries.length === 0 ? <EmptyState>No delivery records match these filters.</EmptyState> : <ListPagination label="Delivery" offset={data.offset} shown={data.deliveries.length} hasMore={data.hasMore} onPrevious={() => setOffset((current) => Math.max(0, current - data.limit))} onNext={() => setOffset((current) => current + data.limit)} />}
    </section>
    <SubscriptionMail rows={data.subscriptionMail} providerName={providerName} />
  </div>;
}
