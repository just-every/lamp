import { useEffect, useRef, useState, type FormEvent } from "react";

import type { IncidentsService } from "../service";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { useOperatorTime, FormError } from "../../../app/client/ui/states";
import { usePageTimezone } from "../../../app/client/ui/timezone";

type Incident = NonNullable<Awaited<ReturnType<IncidentsService["get"]>>>;

type OperatorControlsProps = {
  incident: Incident;
  captureVisit: () => () => boolean;
  captureUpdate: () => () => boolean;
  getDraftVersion: () => string;
  onChanged: () => void;
  onDeleted: () => void;
};

export function IncidentOperatorControls({ incident, captureVisit, captureUpdate, getDraftVersion, onChanged, onDeleted }: OperatorControlsProps) {
  const formatOperatorTime = useOperatorTime();
  const timezone = usePageTimezone();
  // The correction select sits in a narrow column: lifecycle, day and time are enough to tell updates apart.
  const shortTime = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const [note, setNote] = useState("");
  const noteRevision = useRef(0);
  const [correctionId, setCorrectionId] = useState(incident.updates[0]?.id ?? "");
  useEffect(() => { setCorrectionId(current => incident.updates.some(update => update.id === current) ? current : incident.updates[0]?.id ?? ""); }, [incident.updates]);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: (isCurrent: () => boolean) => Promise<string>) => {
    const isCurrent = captureUpdate();
    setError(null);
    try { const message = await action(isCurrent); if (!isCurrent()) return; setMessage(message); onChanged(); }
    catch (cause) { if (!isCurrent()) return; setMessage(null); setError(cause instanceof Error ? cause.message : "The operator action could not be completed."); }
  };

  const saveNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!note.trim()) { setError("Write an internal note before saving it."); return; }
    const submittedRevision = noteRevision.current;
    void run(async (isCurrent) => {
      await appApi(`/api/app/incidents/${incident.id}/internal-notes`, { method: "POST", body: JSON.stringify({ body: note }) });
      if (isCurrent()) setNote(current => isCurrent() && noteRevision.current === submittedRevision ? "" : current);
      return "Internal note saved.";
    });
  };

  const deleteIncident = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) { setError("Give a reason for deleting."); return; }
    // Deletion belongs to the incident visit, even if an update was published
    // while its native request was in flight. It has no draft refresh to run.
    const isCurrent = captureVisit();
    setError(null);
    try {
      await appApi(`/api/app/incidents/${incident.id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
      if (isCurrent()) onDeleted();
    } catch (cause) {
      if (!isCurrent()) return;
      setMessage(null); setError(cause instanceof Error ? cause.message : "The operator action could not be completed.");
    }
  };

  return <section className="incident-operator-controls" aria-label="Private actions">
    <form className="incident-note-form" onSubmit={saveNote}>
      <label className="form-label">Internal note<textarea aria-label="Internal note" value={note} maxLength={5_000} onChange={(event) => { noteRevision.current += 1; setNote(event.target.value); }} placeholder="Context for operators only" /></label>
      <Button type="submit" variant="secondary">Save internal note</Button>
    </form>
    {incident.internalNotes.length ? <div className="incident-note-list" aria-label="Saved internal notes">{incident.internalNotes.map((entry) => <article key={entry.id}><p>{entry.body}</p><small style={{overflowWrap:"anywhere"}}>{formatOperatorTime(entry.createdAt)}{entry.agentAttribution ? ` · ${entry.agentAttribution.label}` : ""}</small></article>)}</div> : null}
    <div className="incident-operator-action"><div><strong>Review this draft</strong><p>Another operator can review before the scheduled update.</p></div><Button type="button" variant="secondary" onClick={() => void run(async () => { await appApi(`/api/app/incidents/${incident.id}/draft/review`, { method: "POST", headers: { "If-Match": getDraftVersion() } }); return "Draft reviewed."; })}>Review saved draft</Button></div>
    {incident.updates.length ? <div className="incident-operator-action incident-correction-action"><div><strong>Correct a published update</strong><p>Mark this draft as a correction to an earlier update.</p></div><div className="incident-correction-controls"><select aria-label="Published update to correct" value={correctionId} onChange={(event) => setCorrectionId(event.target.value)}>{incident.updates.map((update) => <option key={update.id} value={update.id}>{update.lifecycle} · {shortTime(update.publishedAt)}</option>)}</select><Button type="button" variant="secondary" onClick={() => void run(async () => { await appApi(`/api/app/incidents/${incident.id}/draft/correction`, { method: "POST", headers: { "If-Match": getDraftVersion() }, body: JSON.stringify({ updateId: correctionId }) }); return "The draft will publish as a correction."; })}>Mark correction</Button></div></div> : null}
    <div className="incident-delete-action"><div><strong>Delete this incident</strong><p>Removes it from public history. The audit log keeps who deleted it and why.</p></div>{deleting ? <form className="incident-delete-form" onSubmit={deleteIncident}><label className="form-label">Deletion reason<input aria-label="Deletion reason" value={reason} maxLength={1_000} onChange={(event) => setReason(event.target.value)} placeholder="Why this record must be removed" /></label><div><Button type="button" variant="secondary" onClick={() => { setDeleting(false); setReason(""); }}>Cancel</Button><Button type="submit">Confirm deletion</Button></div></form> : <Button type="button" variant="secondary" className="danger-button" onClick={() => setDeleting(true)}>Delete incident</Button>}</div>
    {message ? <p className="incident-action-message" role="status">{message}</p> : null}
    {error ? <FormError>{error}</FormError> : null}
  </section>;
}
