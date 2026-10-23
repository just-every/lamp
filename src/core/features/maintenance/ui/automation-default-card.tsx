import { useRef, useState } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { useLeaveGuard } from "../../../app/client/ui/leave-guard";
import { Button } from "../../../app/client/ui/button";
import type { MaintenanceAutomation } from "../automation.repository";

type Response = { automation: MaintenanceAutomation };

/** Page defaults affect the next window; each existing window keeps its choices. */
export function MaintenanceAutomationCard() {
  const resource = useAppData<Response>("/api/app/maintenance/automation");
  const [draft, setDraft] = useState<MaintenanceAutomation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const failed = useRef(false);
  const choices = draft ?? resource.data?.automation;
  useLeaveGuard(async () => {
    if (pending.current) return await pending.current;
    return !failed.current || window.confirm("Leave without saving maintenance automation?");
  }, () => pending.current !== null || failed.current);

  function save(value: MaintenanceAutomation) {
    setDraft(value); setBusy(true); setError(null); failed.current = false;
    const operation = appApi<Response>("/api/app/maintenance/automation", { method: "PUT", body: JSON.stringify(value) })
      .then(() => true, cause => {
        failed.current = true;
        setError(cause instanceof Error ? cause.message : "Maintenance automation could not be saved.");
        return false;
      }).finally(() => { pending.current = null; setBusy(false); });
    pending.current = operation;
  }

  return <section className="data-card maintenance-automation-card" aria-labelledby="maintenance-automation-title">
    <h2 id="maintenance-automation-title">Maintenance automation</h2>
    <p>Defaults for new maintenance windows. Existing windows keep their choices.</p>
    {resource.error && !choices ? <p role="alert">{resource.error} <Button type="button" variant="secondary" onClick={resource.refresh}>Retry</Button></p> : choices ? <fieldset className="maintenance-components" disabled={busy}>
      <legend>New windows</legend>
      <label className="checkbox-label"><input type="checkbox" checked={choices.autoStart} onChange={event => save({ ...choices, autoStart: event.target.checked })} />Auto-start maintenance</label>
      <label className="checkbox-label"><input type="checkbox" checked={choices.autoComplete} onChange={event => save({ ...choices, autoComplete: event.target.checked })} />Auto-complete maintenance</label>
    </fieldset> : <p role="status">Loading maintenance automation…</p>}
    {choices && <p role="status">{busy ? "Saving…" : error ? "Changes kept · not saved" : "Saved"}</p>}
    {error && <p role="alert">{error} <Button type="button" variant="secondary" onClick={() => choices && save(choices)}>Retry</Button></p>}
  </section>;
}
