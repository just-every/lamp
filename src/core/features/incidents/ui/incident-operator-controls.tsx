import { useState, type FormEvent } from "react";

import type { IncidentsService } from "../service";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { ErrorState, formatOperatorTime } from "../../../app/client/ui/states";

type Incident = NonNullable<Awaited<ReturnType<IncidentsService["get"]>>>;

export function IncidentOperatorControls({ incident, onChanged, onDeleted }: { incident: Incident; onChanged: () => void; onDeleted: () => void }) {
  const [note, setNote] = useState("");
  const [correctionId, setCorrectionId] = useState(incident.updates[0]?.id ?? "");
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<string>) => {
    setError(null);
    try { setMessage(await action()); onChanged(); }
    catch (cause) { setMessage(null); setError(cause instanceof Error ? cause.message : "The operator action could not be completed."); }
  };

  const saveNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!note.trim()) { setError("Write an internal note before saving it."); return; }
    void run(async () => {
      await appApi(`/api/app/incidents/${incident.id}/internal-notes`, { method: "POST", body: JSON.stringify({ body: note }) });
      setNote("");
      return "Internal note saved.";
    });
  };

  const deleteIncident = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) { setError("Give the deletion a recorded reason."); return; }
    void run(async () => {
      await appApi(`/api/app/incidents/${incident.id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
      onDeleted();
      return "";
    });
  };

  return <section className="incident-operator-controls" aria-labelledby="incident-operator-actions-title">
    <div className="incident-operator-heading"><div><p className="card-kicker">Operator record</p><h2 id="incident-operator-actions-title">Private actions</h2></div></div>
    <form className="incident-note-form" onSubmit={saveNote}>
      <label className="form-label">Internal note<textarea aria-label="Internal note" value={note} maxLength={5_000} onChange={(event) => setNote(event.target.value)} placeholder="Context for operators only" /></label>
      <Button type="submit" variant="secondary">Save internal note</Button>
    </form>
    {incident.internalNotes.length ? <div className="incident-note-list" aria-label="Saved internal notes">{incident.internalNotes.map((entry) => <article key={entry.id}><p>{entry.body}</p><small>{formatOperatorTime(entry.createdAt)}</small></article>)}</div> : null}
    <div className="incident-operator-action"><div><strong>Review this draft</strong><p>A different operator can record the required review before scheduled publication.</p></div><Button type="button" variant="secondary" onClick={() => void run(async () => { await appApi(`/api/app/incidents/${incident.id}/draft/review`, { method: "POST" }); return "Draft review recorded."; })}>Review saved draft</Button></div>
    {incident.updates.length ? <div className="incident-operator-action incident-correction-action"><div><strong>Correct a published update</strong><p>Mark the current private draft as a correction before publishing another immutable update.</p></div><div className="incident-correction-controls"><select aria-label="Published update to correct" value={correctionId} onChange={(event) => setCorrectionId(event.target.value)}>{incident.updates.map((update) => <option key={update.id} value={update.id}>{update.lifecycle} · {formatOperatorTime(update.publishedAt)}</option>)}</select><Button type="button" variant="secondary" onClick={() => void run(async () => { await appApi(`/api/app/incidents/${incident.id}/draft/correction`, { method: "POST", body: JSON.stringify({ updateId: correctionId }) }); return "The draft will publish as a correction."; })}>Mark correction</Button></div></div> : null}
    <div className="incident-delete-action"><div><strong>Delete this incident</strong><p>Deletion removes it from public history while retaining the operator audit record.</p></div>{deleting ? <form className="incident-delete-form" onSubmit={deleteIncident}><label className="form-label">Deletion reason<input aria-label="Deletion reason" value={reason} maxLength={1_000} onChange={(event) => setReason(event.target.value)} placeholder="Why this record must be removed" /></label><div><Button type="button" variant="secondary" onClick={() => { setDeleting(false); setReason(""); }}>Cancel</Button><Button type="submit">Confirm deletion</Button></div></form> : <Button type="button" variant="secondary" onClick={() => setDeleting(true)}>Delete incident</Button>}</div>
    {message ? <p className="incident-action-message" role="status">{message}</p> : null}
    {error ? <ErrorState>{error}</ErrorState> : null}
  </section>;
}
