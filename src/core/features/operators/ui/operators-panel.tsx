import { useState, type FormEvent } from "react";

import type { StoredFormerOperator, StoredOperator } from "../repository";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { LoadingState, FormError } from "../../../app/client/ui/states";

type OperatorsResponse = { operators: StoredOperator[] };
type FormerOperatorsResponse = { operators: StoredFormerOperator[] };

/** Operator access and personal-data controls mounted through settings.sections.v1. */
export function OperatorsPanel() {
  const active = useAppData<OperatorsResponse>("/api/app/operators");
  const invited = useAppData<OperatorsResponse>("/api/app/operators/invited");
  const former = useAppData<FormerOperatorsResponse>("/api/app/operators/former");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setMessage(null);
    try {
      await appApi("/api/app/operators/invite", { method: "POST", body: JSON.stringify({ email, displayName }) });
      setEmail(""); setDisplayName(""); setMessage("Invitation email sent.");
      invited.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The invitation could not be sent.");
    } finally { setSaving(false); }
  }

  async function revokeAccess(operator: StoredOperator) {
    setSaving(true); setMessage(null);
    try {
      await appApi(`/api/app/operators/${operator.id}/revoke-access`, { method: "POST" });
      setMessage(`${operator.displayName} no longer has operator access.`);
      active.refresh(); invited.refresh(); former.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The operator’s access could not be removed.");
    } finally { setSaving(false); }
  }

  async function erase(operator: StoredOperator | StoredFormerOperator) {
    if (!window.confirm(`Erase ${operator.displayName}'s personal data? This permanently removes their email, display name and provider identity, and revokes their sessions and sign-in links.`)) return;
    setSaving(true); setMessage(null);
    try {
      await appApi(`/api/app/operators/${operator.id}`, { method: "DELETE" });
      setMessage(`${operator.displayName}'s personal data has been erased. The audit record keeps only their opaque operator ID.`);
      active.refresh(); invited.refresh(); former.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The operator’s personal data could not be erased.");
    } finally { setSaving(false); }
  }

  if (active.loading || invited.loading || former.loading) return <LoadingState>Loading operator access…</LoadingState>;
  if (active.error || invited.error || former.error) return <FormError>{active.error ?? invited.error ?? former.error}</FormError>;
  if (!active.data || !invited.data || !former.data) return null;

  return <section className="data-card operators-card" aria-labelledby="operators-title">
    <div>
      <p className="card-kicker">Operator access</p>
      <h2 id="operators-title">Operators</h2>
      <p>Every active operator has the same access. Remove access to revoke sessions and sign-in links. Erase personal data is irreversible and retains only opaque audit attribution.</p>
    </div>
    <form action="/auth/step-up" method="post">
      <input type="hidden" name="action" value="owner:transfer" />
      <input type="hidden" name="returnTo" value="/app/settings" />
      <p>Before changing operator access, confirm your identity with an email link. Confirmation lasts ten minutes.</p>
      <Button variant="secondary">Confirm my identity</Button>
      <a href="/auth/settings/identity">Identity provider settings</a>
    </form>
    <form className="operators-invite-form" onSubmit={invite}>
      <label className="form-label">Email<input required type="email" value={email} placeholder="operator@example.com" onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="form-label">Name<input required maxLength={120} value={displayName} placeholder="Operator name" onChange={(event) => setDisplayName(event.target.value)} /></label>
      <Button disabled={saving}>{saving ? "Sending…" : "Invite operator"}</Button>
    </form>
    {message && <p className="save-message" role="status">{message}</p>}
    <div className="operators-list" aria-label="Active operators">
      {active.data.operators.map((operator) => <OperatorRow key={operator.id} operator={operator} saving={saving} onRevoke={() => revokeAccess(operator)} onErase={() => erase(operator)} />)}
    </div>
    {invited.data.operators.length > 0 && <section className="former-operators" aria-labelledby="invited-operators-title">
      <h3 id="invited-operators-title">Pending invitations</h3>
      <p>These people have not accepted their invitation. Erasing their personal data cancels every outstanding invitation link.</p>
      <div className="operators-list">{invited.data.operators.map((operator) => <OperatorRow key={operator.id} operator={operator} saving={saving} onErase={() => erase(operator)} />)}</div>
    </section>}
    {former.data.operators.length > 0 && <section className="former-operators" aria-labelledby="former-operators-title">
      <h3 id="former-operators-title">Former operators</h3>
      <p>These people no longer have access. Their personal data remains only until an operator erases it.</p>
      <div className="operators-list">{former.data.operators.map((operator) => <OperatorRow key={operator.id} operator={operator} saving={saving} onErase={() => erase(operator)} />)}</div>
    </section>}
  </section>;
}

function OperatorRow({ operator, saving, onRevoke, onErase }: { operator: StoredOperator | StoredFormerOperator; saving: boolean; onRevoke?: () => void; onErase: () => void }) {
  return <div className="operator-row">
    <span><strong>{operator.displayName}</strong><small>{operator.email}{operator.isSetupOperator ? " · setup operator" : ""}</small></span>
    <div className="operator-actions">
      {onRevoke && <Button type="button" variant="secondary" className="table-action" disabled={saving} onClick={onRevoke}>Remove access</Button>}
      <Button type="button" variant="secondary" className="table-action erase-operator-action" disabled={saving} onClick={onErase}>Erase personal data</Button>
    </div>
  </div>;
}
