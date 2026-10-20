import { useState } from "react";
import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";
import { usePageTimezone } from "../../../app/client/ui/timezone";
import type { PerformanceResponse } from "../types";
import { usePanelRead } from "./use-panel-read";
import { ReachCounts, duration } from "./reach-counts";
import "./performance.css";

/** Mounted in Overview; month changes and polling leave its other cards alone. */
export function CommunicationPerformance() {
  const timezone = usePageTimezone(), time = useOperatorTime();
  // The server chooses the initial calendar month, including at a month boundary.
  const [selectedMonth, setMonth] = useState<string | null>(null);
  const path = `/api/app/communication-performance${selectedMonth ? `?month=${encodeURIComponent(selectedMonth)}` : ""}`;
  const { element, data, error, loading, refresh } = usePanelRead<PerformanceResponse>(path);
  const month = selectedMonth ?? data?.month ?? "";
  const monthPicker = <label className="form-label communication-month" htmlFor="communication-performance-month">Month<input id="communication-performance-month" aria-label="Communication performance month" type="month" required value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} /><small>Times in {timezone}.</small></label>;
  return <section className="data-card communication-panel" aria-label="Communication performance" ref={element}>
    <div className="card-heading"><h2>Communication performance</h2>{data && data.summary.incidentCount > 0 ? <Button asChild variant="secondary"><a href={`${path}${selectedMonth ? "&" : "?"}format=csv`} download={`communication-performance-${month}.csv`}>Download CSV</a></Button> : null}</div>
    {error ? <FormError>{error}</FormError> : null}
    {error ? <Button type="button" variant="secondary" onClick={refresh}>Refresh performance</Button> : null}
    {loading && !data ? <p role="status">Loading communication performance…</p> : null}
    {data?.summary.incidentCount === 0 ? <><p>No incidents this month. Figures appear after your first update.</p><details><summary>Choose month</summary>{monthPicker}</details></> : null}
    {data && data.summary.incidentCount > 0 ? <>
      {monthPicker}
      <dl className="communication-metrics"><div><dt>Incidents</dt><dd>{data.summary.incidentCount}</dd></div><div><dt>Promises kept</dt><dd>{data.summary.commitments.kept} of {data.summary.commitments.evaluated} ({data.summary.commitments.missed} missed; {data.summary.commitments.pending} pending)</dd></div><div><dt>Average alert to first update</dt><dd>{duration(data.summary.averageFirstUpdateLatencyMs)}<small>{data.summary.knownFirstUpdateLatencyCount} known; {data.summary.unknownFirstUpdateLatencyCount} unknown</small></dd></div><div><dt>Average time to resolve</dt><dd>{duration(data.summary.averageResolutionDurationMs)}<small>{data.summary.resolvedDurationCount} known durations</small></dd></div><div><dt>Reports due</dt><dd>{data.summary.reportsOwed}</dd></div></dl>
      <details className="communication-updates"><summary>Email and webhook deliveries</summary><ReachCounts reach={data.summary} /></details>
      <div className="communication-incidents">{data.incidents.map(incident => <details key={incident.incidentId}><summary>{incident.reference} · {incident.title}</summary><dl className="communication-metrics"><div><dt>First accepted alert</dt><dd>{time(incident.firstAcceptedAlertAt)}</dd></div><div><dt>First public update</dt><dd>{time(incident.firstPublicUpdateAt)}</dd></div><div><dt>Alert to first update</dt><dd>{duration(incident.firstUpdateLatencyMs)}</dd></div><div><dt>Time to resolve</dt><dd>{duration(incident.resolutionDurationMs)}</dd></div><div><dt>Promises kept</dt><dd>{incident.commitments.kept} of {incident.commitments.evaluated}; {incident.commitments.pending} pending</dd></div><div><dt>Report owed</dt><dd>{incident.reportOwed ? "Yes" : "No"}</dd></div></dl><ReachCounts reach={incident} /></details>)}</div>
      <details className="communication-definitions"><summary>How these figures are measured</summary><p>Incidents opened from {time(data.startsAt)} up to {time(data.endsAt)}. Includes later updates and their current delivery results.</p>{Object.entries(data.definitions).map(([key, definition]) => <p key={key}>{definition}</p>)}</details>
      <p className="communication-note">Updated {time(data.measuredAt)}</p>
    </> : null}
  </section>;
}
