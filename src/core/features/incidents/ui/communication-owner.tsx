import { useId, useState, type FormEvent } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";

export type CommunicationOwner = { id: string; displayName: string } | null;

/** Private operator control; the public renderer never imports this view. */
export function CommunicationOwnerControl({ incidentId, lifecycle, owner, unowned, captureVisit, onChanged }: {
  incidentId: string;
  lifecycle: string;
  owner: CommunicationOwner;
  unowned: boolean;
  captureVisit: () => () => boolean;
  onChanged: () => void;
}) {
  const selectId = useId();
  const { data, error: optionsError } = useAppData<{ operators: NonNullable<CommunicationOwner>[] }>(lifecycle === "Resolved" ? null : `/api/app/incidents/${incidentId}/owner/operators`);
  const [operatorId, setOperatorId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function change(takeOver: boolean) {
    const isCurrent = captureVisit();
    setPending(true); setError(null); setMessage(null);
    try {
      await appApi(`/api/app/incidents/${incidentId}/owner${takeOver ? "/take-over" : ""}`, { method: takeOver ? "POST" : "PUT", ...(takeOver ? {} : { body: JSON.stringify({ operatorId }) }) });
      if (!isCurrent()) return;
      setMessage(takeOver ? "You are now the communication owner." : "Communication owner reassigned.");
      onChanged();
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : "The communication owner could not be changed.");
    } finally { if (isCurrent()) setPending(false); }
  }
  function reassign(event: FormEvent) { event.preventDefault(); if (operatorId) void change(false); }
  return <section className="data-card incident-operator-controls" aria-label="Communication owner">
    <h2>Communication owner</h2>
    <p>{unowned ? <strong>Unowned — an active operator needs to take over.</strong> : <span>Owned by <strong>{owner?.displayName}</strong></span>}</p>
    {lifecycle !== "Resolved" ? <>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => void change(true)}>Take over communication</Button>
      <form className="incident-note-form" onSubmit={reassign}>
        <label className="form-label" htmlFor={selectId}>Reassign communication owner</label>
        <select id={selectId} value={operatorId} onChange={event => setOperatorId(event.target.value)} disabled={pending || !data}>
          <option value="">Choose an active operator</option>
          {data?.operators.map(operator => <option key={operator.id} value={operator.id}>{operator.displayName}</option>)}
        </select>
        <Button type="submit" variant="secondary" disabled={pending || !operatorId}>Reassign owner</Button>
      </form>
      {optionsError && <FormError>{optionsError}</FormError>}
    </> : null}
    {error && <FormError>{error}</FormError>}
    {message && <p role="status">{message}</p>}
  </section>;
}
