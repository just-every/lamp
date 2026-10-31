import { useEffect, useState } from "react";

import type { IncidentsService } from "../service";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { usePageTimezone } from "../../../app/client/ui/timezone";

type Incident = NonNullable<Awaited<ReturnType<IncidentsService["get"]>>>;

/** The draft's own actions under the +: Mark draft reviewed acts at once; Publish as a correction first asks which
 * published update. Both answer beside the Publish row, and a publication in between makes the answer stale. */
export function useDraftActions({ incidentId, captureUpdate, getDraftVersion, onChanged }: { incidentId: string; captureUpdate: () => () => boolean; getDraftVersion: () => string; onChanged: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<string>) => {
    const isCurrent = captureUpdate();
    setError(null); setMessage(null);
    try { const done = await action(); if (!isCurrent()) return; setMessage(done); onChanged(); }
    catch (cause) { if (!isCurrent()) return; setError(cause instanceof Error ? cause.message : "The operator action could not be completed."); }
  };
  const review = () => void run(async () => { await appApi(`/api/app/incidents/${incidentId}/draft/review`, { method: "POST", headers: { "If-Match": getDraftVersion() } }); return "Draft reviewed."; });
  const correct = (updateId: string) => void run(async () => { await appApi(`/api/app/incidents/${incidentId}/draft/correction`, { method: "POST", headers: { "If-Match": getDraftVersion() }, body: JSON.stringify({ updateId }) }); return "The draft will publish as a correction."; });
  return { review, correct, message, error };
}

/** Which published update this draft corrects, in a small select; the draft then publishes as its correction. */
export function CorrectionChoice({ updates, onCorrect }: { updates: Incident["updates"]; onCorrect: (updateId: string) => void }) {
  const timezone = usePageTimezone();
  // Lifecycle, day and time are enough to tell updates apart.
  const shortTime = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const [correctionId, setCorrectionId] = useState(updates[0]?.id ?? "");
  useEffect(() => { setCorrectionId(current => updates.some(update => update.id === current) ? current : updates[0]?.id ?? ""); }, [updates]);
  return <div className="correction-choice">
    <select aria-label="Published update to correct" value={correctionId} onChange={(event) => setCorrectionId(event.target.value)}>{updates.map((update) => <option key={update.id} value={update.id}>{update.lifecycle} · {shortTime(update.publishedAt)}</option>)}</select>
    <Button type="button" variant="secondary" disabled={!correctionId} onClick={() => onCorrect(correctionId)}>Mark as correction</Button>
  </div>;
}
