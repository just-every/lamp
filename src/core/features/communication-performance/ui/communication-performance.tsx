import { useId, useState } from "react";
import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";
import { usePageTimezone } from "../../../app/client/ui/timezone";
import { pageMonth } from "../month";
import type { PerformanceResponse } from "../types";
import { usePanelRead } from "./use-panel-read";
import { ReachCounts, duration } from "./reach-counts";
import { useCsvDownload } from "./download";
import "./performance.css";

/** Mounted in Overview; month changes and polling leave its other cards alone. */
export function CommunicationPerformance() {
  const timezone = usePageTimezone(), time = useOperatorTime(), monthId = useId();
  const [month, setMonth] = useState(() => pageMonth(new Date().toISOString(), timezone));
  const path = `/api/app/communication-performance?month=${encodeURIComponent(month)}`;
  const { element, data, error, loading, refresh } = usePanelRead<PerformanceResponse>(path);
  const csv = useCsvDownload();
  return <section className="data-card communication-panel" aria-label="Communication performance" ref={element}>
    <div className="card-heading"><h2>Communication performance</h2><Button type="button" variant="secondary" disabled={!data || csv.downloading} onClick={() => csv.download(`${path}&format=csv`, `communication-performance-${month}.csv`)}>{csv.downloading ? "Downloading…" : "Download CSV"}</Button></div>
    <label className="form-label communication-month" htmlFor={monthId}>Incidents opened in month<input id={monthId} aria-label="Communication performance month" type="month" required value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} /></label>
    <p>Calendar month in {timezone}. Includes later communication and current delivery outcomes for those incidents.</p>
    {error || csv.error ? <FormError>{error ?? csv.error}</FormError> : null}
    {error ? <Button type="button" variant="secondary" onClick={refresh}>Refresh performance</Button> : null}
    {loading && !data ? <p role="status">Loading communication performance…</p> : null}
    {data ? <>
      <dl className="communication-metrics"><div><dt>Incidents</dt><dd>{data.summary.incidentCount}</dd></div><div><dt>Promises kept</dt><dd>{data.summary.commitments.kept} of {data.summary.commitments.evaluated} ({data.summary.commitments.missed} missed; {data.summary.commitments.pending} pending)</dd></div><div><dt>Average alert to first update</dt><dd>{duration(data.summary.averageFirstUpdateLatencyMs)}<small>{data.summary.knownFirstUpdateLatencyCount} known; {data.summary.unknownFirstUpdateLatencyCount} unknown</small></dd></div><div><dt>Average time to resolve</dt><dd>{duration(data.summary.averageResolutionDurationMs)}<small>{data.summary.resolvedDurationCount} known durations</small></dd></div><div><dt>Reports owed now</dt><dd>{data.summary.reportsOwed}</dd></div></dl>
      <ReachCounts reach={data.summary} />
      {data.incidents.length ? <div className="communication-incidents">{data.incidents.map(incident => <details key={incident.incidentId}><summary>{incident.reference} · {incident.title}</summary><dl className="communication-metrics"><div><dt>First accepted alert</dt><dd>{time(incident.firstAcceptedAlertAt)}</dd></div><div><dt>First public update</dt><dd>{time(incident.firstPublicUpdateAt)}</dd></div><div><dt>Alert to first update</dt><dd>{duration(incident.firstUpdateLatencyMs)}</dd></div><div><dt>Time to resolve</dt><dd>{duration(incident.resolutionDurationMs)}</dd></div><div><dt>Promises kept</dt><dd>{incident.commitments.kept} of {incident.commitments.evaluated}; {incident.commitments.pending} pending</dd></div><div><dt>Report owed</dt><dd>{incident.reportOwed ? "Yes" : "No"}</dd></div></dl><ReachCounts reach={incident} /></details>)}</div> : <p>No incidents opened in this month.</p>}
      <details className="communication-definitions"><summary>How these figures are measured</summary>{Object.entries(data.definitions).map(([key, definition]) => <p key={key}>{definition}</p>)}</details>
      <p className="communication-note">Measured {time(data.measuredAt)} · {data.timezone}. Cohort {time(data.startsAt)} inclusive to {time(data.endsAt)} exclusive.</p>
    </> : null}
  </section>;
}
