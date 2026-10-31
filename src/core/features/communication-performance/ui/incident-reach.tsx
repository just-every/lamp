import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";
import type { IncidentReachResponse, ReachSummary } from "../types";
import { usePanelRead } from "./use-panel-read";
import { ReachCounts, duration } from "./reach-counts";
import { useCsvDownload } from "./download";
import "./performance.css";

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** One line naming what was sent, or null while nothing has been sent for the incident. Planned sends do not count:
 * a subscriber is counted once the provider accepted or delivered the message, a post once the destination accepted it. */
function sentLine(reach: ReachSummary) {
  const sent = (channel: "email" | "webhook") => { const found = reach.channels.find(item => item.channel === channel); return found ? Math.max(found.distinctProviderAccepted ?? 0, found.distinctDelivered ?? 0) : 0; };
  const posts = reach.operatorPosts.reduce((total, post) => total + post.accepted, 0);
  const parts = [
    ...(sent("email") ? [`Emailed ${plural(sent("email"), "subscriber", "subscribers")}`] : []),
    ...(sent("webhook") ? [`Sent to ${plural(sent("webhook"), "webhook", "webhooks")}`] : []),
    ...(posts ? [plural(posts, "Slack or Teams post", "Slack and Teams posts")] : []),
  ];
  return parts.length ? parts.join(" · ") : null;
}

/** The incident's reach, read while its place is on screen. `line` stays null until something was sent, so reach
 * appears only once the server reports a send. */
export function useIncidentReach(incidentId: string, updateIds: readonly string[]) {
  const path = `/api/app/incidents/${encodeURIComponent(incidentId)}/reach`;
  const read = usePanelRead<IncidentReachResponse>(path, [...updateIds].sort().join(","));
  return { ...read, path, line: read.data ? sentLine(read.data.incident) : null };
}

/** The delivery figures behind the reach line. */
export function ReachDetails({ path, data, onRefresh, error }: { path: string; data: IncidentReachResponse; onRefresh: () => void; error: string | null }) {
  const csv = useCsvDownload(), time = useOperatorTime();
  return <div className="incident-reach communication-panel">
    {error || csv.error ? <FormError>{error ?? csv.error}</FormError> : null}
    {error ? <Button variant="secondary" type="button" onClick={onRefresh}>Refresh counts</Button> : null}
    <dl className="communication-metrics"><div><dt>First accepted alert</dt><dd>{time(data.incident.firstAcceptedAlertAt)}</dd></div><div><dt>First public update</dt><dd>{time(data.incident.firstPublicUpdateAt)}</dd></div><div><dt>Alert to first update</dt><dd>{duration(data.incident.firstUpdateLatencyMs)}</dd></div><div><dt>Time to resolve</dt><dd>{duration(data.incident.resolutionDurationMs)}</dd></div><div><dt>Promises kept</dt><dd>{data.incident.commitments.kept} of {data.incident.commitments.evaluated}; {data.incident.commitments.pending} pending</dd></div><div><dt>Report owed</dt><dd>{data.incident.reportOwed ? "Yes" : "No"}</dd></div></dl>
    <h4>Whole incident</h4><ReachCounts reach={data.incident} />
    <details className="communication-updates"><summary>Reach of each update ({data.updates.length})</summary>{data.updates.map(update => <article className="communication-update" key={update.updateId} data-update-id={update.updateId}><h4>{time(update.publishedAt)}</h4><p>{update.retainedImport ? "Imported history; source delivery unknown." : `Subscriber channels selected: ${update.selectedChannels.join(", ") || "none"}.`}</p><ReachCounts reach={update} /></article>)}</details>
    <details className="communication-definitions"><summary>How these figures are measured</summary>{Object.entries(data.definitions).map(([key, definition]) => <p key={key}>{definition}</p>)}</details>
    <p className="communication-note">Measured {time(data.measuredAt)} · {data.timezone}</p>
    <Button variant="secondary" type="button" disabled={csv.downloading} onClick={() => csv.download(`${path}?format=csv`, "incident-reach.csv")}>{csv.downloading ? "Downloading…" : "Download CSV"}</Button>
  </div>;
}
