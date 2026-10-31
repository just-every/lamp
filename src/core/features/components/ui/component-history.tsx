import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { ComponentHistoryView, ComponentView } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { FormError, LoadingState, useOperatorTime } from "../../../app/client/ui/states";
import { fromPageDateTime, usePageTimezone } from "../../../app/client/ui/timezone";
import { AvailabilityReport } from "../../availability-reports/ui/availability-report";

/** History: state changes and corrections, this component's availability report and a closed correction form. A saved
 * correction is listed in place and the form clears for the next; the drawer stays open, keeping Details and its metrics. */
export function ComponentHistory({ component, onSaved }: { component: ComponentView; onSaved: () => void }) {
  const formatOperatorTime = useOperatorTime();
  const timezone = usePageTimezone();
  const { data, error, loading, refresh } = useAppData<ComponentHistoryView>(`/api/app/components/${component.id}/history`);
  const [state, setState] = useState<ComponentState>("Operational");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);

  async function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setSaved(false); setMutationError(null);
    try {
      await appApi(`/api/app/components/${component.id}/history-corrections`, { method: "POST", body: JSON.stringify({ state, startsAt: fromPageDateTime(startsAt, timezone), endsAt: fromPageDateTime(endsAt, timezone), reason }) });
      setState("Operational"); setStartsAt(""); setEndsAt(""); setReason(""); setSaved(true);
      refresh(); onSaved();
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "The correction could not be saved.");
    } finally {
      // Saving disables the button, which drops keyboard focus; the drawer stays open, so focus comes back to it.
      flushSync(() => setSaving(false));
      if (document.activeElement === document.body) saveButton.current?.focus();
    }
  }

  return <div className="component-history-part">
    {error ? <FormError>{error}</FormError> : null}
    {loading && !data ? <LoadingState /> : data ? <>
      <section className="component-history" aria-label="Component state history" tabIndex={0}>{data.history.length ? data.history.map((entry) => <article key={entry.id}><strong>{entry.previousState} → {entry.newState}</strong><small>{entry.causeType === "standing-claim" ? "Operator status" : entry.causeType.replaceAll("-", " ")} · {formatOperatorTime(entry.changedAt)}</small></article>) : <p>No status changes yet.</p>}</section>
      {data.corrections.length ? <section className="component-corrections" aria-label="Corrections"><h3>Corrections</h3>{data.corrections.map((correction) => <article key={correction.id}><strong>{correction.state}</strong><small>{formatOperatorTime(correction.startsAt)} to {formatOperatorTime(correction.endsAt)}</small><p>{correction.reason}</p></article>)}</section> : null}
    </> : null}
    <AvailabilityReport component={component} />
    <details className="component-correction"><summary>Correct a past period</summary><form className="component-correction-form" onSubmit={correct} onChange={() => setSaved(false)}>
      <p>Earlier entries stay. Times in {timezone}.</p>
      <label className="form-label">Correct state<select value={state} onChange={(event) => setState(event.target.value as ComponentState)}>{COMPONENT_STATES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <div className="component-editor-grid"><label className="form-label">Starts at<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="form-label">Ends at<input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>
      <label className="form-label">Reason<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {mutationError && <FormError>{mutationError}</FormError>}
      <div className="drawer-actions">{saved && <p className="settings-save-note" role="status"><Icon name="check" width={16} height={16} />Correction saved</p>}<Button ref={saveButton} type="submit" disabled={saving}>{saving ? "Saving…" : "Save correction"}</Button></div>
    </form></details>
  </div>;
}
