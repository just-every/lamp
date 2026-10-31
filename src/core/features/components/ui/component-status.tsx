import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { ComponentView } from "../service";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { FormError } from "../../../app/client/ui/states";
import { publicStateSource } from "./public-state-source";

/** Status: the operator's own setting for the component, beside the public state it combines into. Saving keeps the
 * drawer open on Status while the page refreshes beneath it, so nothing held in Details or its metrics is dropped. */
export function ComponentStatus({ component, onSaved }: { component: ComponentView; onSaved: () => void }) {
  const [state, setState] = useState<ComponentState | "">(component.standingClaimState ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const source = publicStateSource(component);

  async function save() {
    setSaving(true); setSaved(false); setError(null);
    try {
      await appApi(`/api/app/components/${component.id}/standing-claim`, { method: "PUT", body: JSON.stringify({ state: state || null }) });
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The status could not be saved.");
    } finally {
      // Saving disables the button, which drops keyboard focus; the drawer stays open, so focus comes back to it.
      flushSync(() => setSaving(false));
      if (document.activeElement === document.body) saveButton.current?.focus();
    }
  }

  return <div className="component-status">
    <dl className="component-public-state"><dt>Current public state</dt><dd>{component.publicState}{source === "incident" ? " · from an incident" : source === "maintenance" ? " · from maintenance" : ""}</dd></dl>
    <label className="form-label">Service status<select value={state} onChange={(event) => { setState(event.target.value as ComponentState | ""); setSaved(false); }}><option value="">Automatic (Operational unless affected)</option>{COMPONENT_STATES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
    <p className="component-status-note">The public state is the most severe of this, open incidents and maintenance in progress.</p>
    {error && <FormError>{error}</FormError>}
    <div className="drawer-actions">{saved && <p className="settings-save-note" role="status"><Icon name="check" width={16} height={16} />Status saved</p>}<Button ref={saveButton} type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save status"}</Button></div>
  </div>;
}
