import type { ReachSummary } from "../types";

export const count = (value: number | null) => value === null ? "Unknown" : value.toLocaleString();
export const duration = (value: number | null) => value === null ? "Unknown" : value < 60000 ? `${Math.round(value / 1000)} sec` : value < 3600000 ? `${Math.round(value / 60000)} min` : `${(value / 3600000).toFixed(1)} hr`;
export function ReachCounts({ reach }: { reach: ReachSummary }) {
  return <div className="communication-counts">
    <div className="communication-channels">{reach.channels.map(channel => <div className="communication-channel" key={channel.channel}>
      <strong>{channel.channel === "email" ? "Email" : "Webhook"}</strong>
      {channel.coverage !== "known" ? <p>{channel.coverage === "unknown" ? "Historical delivery unknown" : "Known records; historical delivery incomplete"}</p> : null}
      <dl><div><dt>Committed sends</dt><dd>{count(channel.committed)}</dd></div><div><dt>Delivered sends</dt><dd>{count(channel.delivered)}</dd></div><div><dt>Distinct subscribers delivered</dt><dd>{count(channel.distinctDelivered)}</dd></div><div><dt>Distinct subscribers committed</dt><dd>{count(channel.distinctCommitted)}</dd></div><div><dt>Provider accepted sends</dt><dd>{count(channel.providerAccepted)}</dd></div><div><dt>Queued</dt><dd>{count(channel.queued)}</dd></div><div><dt>Bounced</dt><dd>{count(channel.bounced)}</dd></div><div><dt>Complained</dt><dd>{count(channel.complained)}</dd></div><div><dt>Suppressed</dt><dd>{count(channel.suppressed)}</dd></div><div><dt>Failed</dt><dd>{count(channel.failed)}</dd></div></dl>
    </div>)}</div>
    <p className="communication-note">Failure rate: {reach.deliveryFailure.rate === null ? "Unknown" : `${(reach.deliveryFailure.rate * 100).toFixed(1)}%`} ({count(reach.deliveryFailure.failures)} / {count(reach.deliveryFailure.denominator)} {reach.deliveryFailure.denominatorLabel}).</p>
    {reach.operatorPosts.some(post => post.committed > 0) ? <div className="communication-note"><strong>Operator channel posts</strong>{reach.operatorPosts.filter(post => post.committed > 0).map(post => <p key={post.channel}>{post.channel === "slack" ? "Slack" : "Teams"}: {post.committed} committed, {post.accepted} accepted, {post.rejected} rejected, {post.uncertain} uncertain, {post.pending} pending. Destination posts are separate from subscriber totals.</p>)}</div> : null}
  </div>;
}
