import { useState } from "react";

import { ApiError, appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { failureText } from "./wording";

/** Base's provider sign-in switch. It saves as it changes, and a refused save keeps the choice with its reason and Retry. */
export function SwitchRow({ enabled, canEdit, onSaved }: { enabled: boolean; canEdit: boolean; onSaved: () => void }) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const shown = choice ?? enabled;
  async function save(next: boolean) {
    setChoice(next); setTouched(true); setPhase("saving"); setError(null);
    try {
      await appApi("/auth/settings/identity", { method: "POST", body: JSON.stringify({ idpSignIn: next }) });
      setPhase("saved"); setChoice(null); onSaved();
    } catch (cause) {
      setPhase("error");
      setError(failureText(cause instanceof ApiError ? cause.message : "", null, null));
    }
  }
  return <section className="data-card tool-step" aria-label="Provider sign-in">
    <label className="checkbox-label">
      <input type="checkbox" checked={shown} disabled={!canEdit || phase === "saving"} onChange={event => void save(event.target.checked)} />
      Let invited people sign in with Google or Okta
    </label>
    {shown && <p className="tool-note">Turning this off signs out people who signed in with Google or Okta.</p>}
    {touched && phase === "saved" && <p className="tool-note" role="status">Saved · live</p>}
    {phase === "saving" && <p className="tool-note" role="status">Saving…</p>}
    {error && <><FormError>{error} Your choice is kept here.</FormError><div className="form-actions"><Button type="button" variant="secondary" onClick={() => void save(shown)}>Retry</Button></div></>}
  </section>;
}
