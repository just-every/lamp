import { useState, type FormEvent } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { Glyph } from "./local-glyphs";

/** The quiet red end of the incident panel: a reason first, then a confirmation. Deletion belongs to the incident visit,
 * even if an update was published while its request was in flight; the audit log keeps who deleted it and why. */
export function DeleteIncident({ incidentId, captureVisit, onDeleted }: { incidentId: string; captureVisit: () => () => boolean; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) { setError("Give a reason for deleting."); return; }
    const isCurrent = captureVisit();
    setError(null);
    try {
      await appApi(`/api/app/incidents/${incidentId}`, { method: "DELETE", body: JSON.stringify({ reason }) });
      if (isCurrent()) onDeleted();
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : "The operator action could not be completed."); }
  };
  return <div className="incident-delete">
    {deleting ? <form className="incident-delete-form" onSubmit={confirm}>
      <label className="form-label">Deletion reason<input aria-label="Deletion reason" value={reason} maxLength={1_000} onChange={(event) => setReason(event.target.value)} placeholder="Why this record must be removed" /></label>
      <p>Removes it from public history. The audit log keeps who deleted it and why.</p>
      <div><Button type="button" variant="secondary" onClick={() => { setDeleting(false); setReason(""); setError(null); }}>Cancel</Button><Button type="submit" className="danger-fill">Confirm deletion</Button></div>
    </form> : <button type="button" className="delete-incident" onClick={() => setDeleting(true)}><Glyph name="trash" />Delete incident</button>}
    {error ? <FormError>{error}</FormError> : null}
  </div>;
}
