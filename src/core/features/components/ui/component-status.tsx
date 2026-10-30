import { useState } from "react";

import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { ComponentView } from "../service";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { publicStateSource } from "./public-state-source";

/** Status: the operator's own setting for the component, beside the public state it combines into. */
export function ComponentStatus({ component, onSaved }: { component: ComponentView; onSaved: () => void }) {
  const [state, setState] = useState<ComponentState | "">(component.standingClaimState ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = publicStateSource(component);

  async function save() {
    setSaving(true); setError(null);
    try {
      await appApi(`/api/app/components/${component.id}/standing-claim`, { method: "PUT", body: JSON.stringify({ state: state || null }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The status could not be saved.");
      setSaving(false);
    }
  }

  return <div className="component-status">
    <dl className="component-public-state"><dt>Current public state</dt><dd>{component.publicState}{source === "incident" ? " · from an incident" : source === "maintenance" ? " · from maintenance" : ""}</dd></dl>
    <label className="form-label">Service status<select value={state} onChange={(event) => setState(event.target.value as ComponentState | "")}><option value="">Automatic (Operational unless affected)</option>{COMPONENT_STATES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
    <p className="component-status-note">The public state is the most severe of this, open incidents and maintenance in progress.</p>
    {error && <FormError>{error}</FormError>}
    <div className="drawer-actions"><Button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save status"}</Button></div>
  </div>;
}
