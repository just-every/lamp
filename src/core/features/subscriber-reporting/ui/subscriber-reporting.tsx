import { useEffect, useId, useRef, useState } from "react";
import { useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";
import { useCsvDownload } from "../../communication-performance/ui/download";
import type { SubscriberReportingResponse } from "../types";

export function SubscriberReporting({ refreshKey }: { refreshKey: number }) {
  const monthId = useId(), channelId = useId(), time = useOperatorTime();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [channel, setChannel] = useState("");
  const path = `/api/app/subscriber-reporting?month=${encodeURIComponent(month)}${channel ? `&channel=${channel}` : ""}`;
  const { data, error, loading, refresh } = useAppData<SubscriberReportingResponse>(path);
  const previousKey = useRef(refreshKey), csv = useCsvDownload();
  useEffect(() => {
    if (previousKey.current !== refreshKey) { previousKey.current = refreshKey; refresh(); }
  }, [refreshKey, refresh]);
  const counts = data?.counts.filter(row => row.count > 0) ?? [];
  const components = data?.components.filter(row => row.count > 0) ?? [];
  const reasons = data?.deactivationReasons.filter(row => row.count > 0) ?? [];
  const daily = data?.daily.filter(row => row.joined > 0 || row.left > 0 || row.openingInventory > 0 || row.closingInventory > 0) ?? [];
  return <section className="subscriber-reporting" aria-label="Subscriber reporting">
    <div className="card-heading"><h2>Subscriber reporting</h2><Button type="button" variant="secondary" disabled={!data || csv.downloading} onClick={() => csv.download(`${path}&format=csv`, "subscriber-reporting.csv")}>{csv.downloading ? "Downloading…" : "Download CSV"}</Button></div>
    <p>Current counts and observed daily changes. Audience and language reporting are not available.</p>
    <div className="subscriber-webhook-form">
      <label className="form-label" htmlFor={monthId}>Growth month (UTC)<input id={monthId} type="month" min="1000-01" max="9998-12" required value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} /></label>
      <label className="form-label" htmlFor={channelId}>Channel<select id={channelId} value={channel} onChange={event => setChannel(event.target.value)}><option value="">All channels</option><option value="email">Email</option><option value="webhook">Webhook</option></select></label>
      <Button type="button" variant="secondary" onClick={refresh} disabled={loading}>Refresh report</Button>
    </div>
    {error || csv.error ? <FormError>{error ?? csv.error}</FormError> : null}
    {loading ? <p role="status">Loading subscriber reporting…</p> : null}
    {data ? <>
      <p><strong>{data.total} current subscribers</strong> · {data.eligible} pending or active. Includes inactive subscribers; excludes deleted people. The month filters growth only.</p>
      {counts.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Current subscriber counts"><table className="subscriber-reporting-current"><thead><tr><th scope="col">Channel</th><th scope="col">State</th><th scope="col">Subscribers</th></tr></thead><tbody>{counts.map(row => <tr key={`${row.channel}/${row.state}`}><td>{row.channel}</td><td>{row.state}</td><td>{row.count}</td></tr>)}</tbody></table></div> : <p>No current subscribers to count.</p>}
      <details><summary>Counts by component</summary><p>All-component subscriptions count for each visible component. Selected subscriptions count for their selected visible components. Counts overlap.</p>
        {components.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Subscriber counts by component"><table className="subscriber-reporting-stack"><thead><tr><th scope="col">Component</th><th scope="col">Group</th><th scope="col">Channel</th><th scope="col">State</th><th scope="col">Subscribers</th></tr></thead><tbody>{components.map(row => <tr key={`${row.componentId}/${row.channel}/${row.state}`}><td data-label="Component">{row.componentName}</td><td data-label="Group">{row.groupName ?? "Ungrouped"}</td><td data-label="Channel">{row.channel}</td><td data-label="State">{row.state}</td><td data-label="Subscribers">{row.count}</td></tr>)}</tbody></table></div> : <p>No subscriber component selections to count.</p>}
      </details>
      <details><summary>Deactivation reasons</summary>{reasons.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Subscriber deactivation counts"><table><thead><tr><th scope="col">Channel</th><th scope="col">Reason</th><th scope="col">Subscribers</th></tr></thead><tbody>{reasons.map(row => <tr key={`${row.channel}/${row.reason}`}><td>{row.channel}</td><td>{row.reason ?? "Unknown"}</td><td>{row.count}</td></tr>)}</tbody></table></div> : <p>No retained deactivated subscribers.</p>}</details>
      <h3>Daily growth</h3>
      <p>Pending and active totals. Tracking began {time(data.trackingStartedAt)} with {data.baseline.map(row => `${row.eligible} ${row.channel}`).join(" and ")}. Earlier growth is unknown. The first tracked day is partial; today is incomplete.</p>
      {daily.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Daily subscriber growth"><table className="subscriber-reporting-stack"><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Channel</th><th scope="col">Joined</th><th scope="col">Left</th><th scope="col">Net change</th><th scope="col">Total</th></tr></thead><tbody>{daily.map(row => <tr key={`${row.day}/${row.channel}`}><td data-label="Day (UTC)">{row.day}</td><td data-label="Channel">{row.channel}</td><td data-label="Joined">{row.joined}</td><td data-label="Left">{row.left}</td><td data-label="Net change">{row.netChange}</td><td data-label="Total">{row.closingInventory}</td></tr>)}</tbody></table></div> : data.daily.length ? <p>No subscriber activity in this range.</p> : <p>No observed days in this range. Historical changes before tracking are unknown.</p>}
      <details><summary>How these figures are measured</summary>{Object.entries(data.definitions).map(([name, definition]) => <p key={name}>{definition}</p>)}</details>
      <p>Measured {time(data.measuredAt)}. Daily growth uses UTC.</p>
    </> : null}
  </section>;
}
