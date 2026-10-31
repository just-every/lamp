import { useId, useRef, useState, type FormEvent } from "react";

import type { IncidentView } from "../service";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";

export const notesSummary = (count: number) => count ? `${count} ${count === 1 ? "note" : "notes"}` : "No notes yet";

/** Operators' private notes on the incident, newest first, and one to add. Customers never see them. */
export function IncidentNotes({ incident, captureUpdate, onChanged }: { incident: IncidentView; captureUpdate: () => () => boolean; onChanged: () => void }) {
  const formatOperatorTime = useOperatorTime();
  const id = useId();
  const [note, setNote] = useState("");
  const noteRevision = useRef(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!note.trim()) { setError("Write an internal note before saving it."); return; }
    const submittedRevision = noteRevision.current;
    const isCurrent = captureUpdate();
    setError(null);
    void appApi(`/api/app/incidents/${incident.id}/internal-notes`, { method: "POST", body: JSON.stringify({ body: note }) })
      .then(() => { if (!isCurrent()) return; setNote(current => noteRevision.current === submittedRevision ? "" : current); setMessage("Internal note saved."); onChanged(); })
      .catch((cause: unknown) => { if (!isCurrent()) return; setMessage(null); setError(cause instanceof Error ? cause.message : "The operator action could not be completed."); });
  };
  return <div className="incident-notes">
    {incident.internalNotes.length ? <div className="note-list" aria-label="Saved internal notes">{incident.internalNotes.map((entry) => <article key={entry.id}><p>{entry.body}</p><small>{formatOperatorTime(entry.createdAt)}</small></article>)}</div> : null}
    <form className="note-form" onSubmit={save}>
      <label className="field-label" htmlFor={id}>Add a note</label>
      <textarea id={id} value={note} maxLength={5_000} rows={3} placeholder="Only operators see notes" onChange={(event) => { noteRevision.current += 1; setNote(event.target.value); }} />
      <Button type="submit" variant="secondary">Save note</Button>
    </form>
    {message ? <p className="panel-message" role="status">{message}</p> : null}
    {error ? <FormError>{error}</FormError> : null}
  </div>;
}
