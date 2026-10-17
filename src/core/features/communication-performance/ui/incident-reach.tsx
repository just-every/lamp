import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { useOperatorTime } from "../../../app/client/ui/states";
import type { IncidentReachResponse } from "../types";
import { usePanelRead } from "./use-panel-read";
import { ReachCounts, duration } from "./reach-counts";
import { useCsvDownload } from "./download";
import "./performance.css";

export function IncidentReach({ incidentId, updateIds }: { incidentId: string; updateIds: readonly string[] }) {
  const path = `/api/app/incidents/${encodeURIComponent(incidentId)}/reach`;
  const { element, data, error, loading, refresh } = usePanelRead<IncidentReachResponse>(path, [...updateIds].sort().join(","));
  const csv = useCsvDownload(), time = useOperatorTime();
  return <section className="context-section communication-panel" aria-label="Incident reach" ref={element}>
    <div className="card-heading"><h2>Communication and reach</h2><Button variant="secondary" type="button" disabled={!data || csv.downloading} onClick={() => csv.download(`${path}?format=csv`, "incident-reach.csv")}>{csv.downloading ? "Downloading…" : "Download CSV"}</Button></div>
    <p>Committed delivery records, refreshed every 15 seconds while visible. Counts describe delivery, never reading.</p>
    {error || csv.error ? <FormError>{error ?? csv.error}</FormError> : null}
    {error ? <Button variant="secondary" type="button" onClick={refresh}>Refresh counts</Button> : null}
    {loading && !data ? <p role="status">Loading delivery counts…</p> : null}
    {data ? <>
      <dl className="communication-metrics"><div><dt>First accepted alert</dt><dd>{time(data.incident.firstAcceptedAlertAt)}</dd></div><div><dt>First public update</dt><dd>{time(data.incident.firstPublicUpdateAt)}</dd></div><div><dt>Alert to first update</dt><dd>{duration(data.incident.firstUpdateLatencyMs)}</dd></div><div><dt>Time to resolve</dt><dd>{duration(data.incident.resolutionDurationMs)}</dd></div><div><dt>Promises kept</dt><dd>{data.incident.commitments.kept} of {data.incident.commitments.evaluated}; {data.incident.commitments.pending} pending</dd></div><div><dt>Report owed</dt><dd>{data.incident.reportOwed ? "Yes" : "No"}</dd></div></dl>
      <h3>Whole incident</h3><ReachCounts reach={data.incident} />
      <details className="communication-updates"><summary>Reach of each update ({data.updates.length})</summary>{data.updates.map(update => <article className="communication-update" key={update.updateId} data-update-id={update.updateId}><h3>{time(update.publishedAt)}</h3><p>{update.retainedImport ? "Imported history; source delivery unknown." : `Subscriber channels selected: ${update.selectedChannels.join(", ") || "none"}.`}</p><ReachCounts reach={update} /></article>)}</details>
      <details className="communication-definitions"><summary>How these figures are measured</summary>{Object.entries(data.definitions).map(([key, definition]) => <p key={key}>{definition}</p>)}</details>
      <p className="communication-note">Measured {time(data.measuredAt)} · {data.timezone}</p>
    </> : null}
  </section>;
}
