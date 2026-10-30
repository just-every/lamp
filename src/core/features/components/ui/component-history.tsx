import { useState, type FormEvent } from "react";

import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { ComponentHistoryView, ComponentView } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError, LoadingState, useOperatorTime } from "../../../app/client/ui/states";
import { fromPageDateTime, usePageTimezone } from "../../../app/client/ui/timezone";
import { AvailabilityReport } from "../../availability-reports/ui/availability-report";

/** History: state changes and corrections, this component's availability report and a closed correction form. */
export function ComponentHistory({ component, onSaved }: { component: ComponentView; onSaved: () => void }) {
  const formatOperatorTime = useOperatorTime();
  const timezone = usePageTimezone();
  const { data, error, loading } = useAppData<ComponentHistoryView>(`/api/app/components/${component.id}/history`);
  const [state, setState] = useState<ComponentState>("Operational");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMutationError(null);
    try {
      await appApi(`/api/app/components/${component.id}/history-corrections`, { method: "POST", body: JSON.stringify({ state, startsAt: fromPageDateTime(startsAt, timezone), endsAt: fromPageDateTime(endsAt, timezone), reason }) });
      onSaved();
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "The correction could not be saved.");
      setSaving(false);
    }
  }

  return <div className="component-history-part">
    {error ? <FormError>{error}</FormError> : null}
    {loading && !data ? <LoadingState /> : data ? <>
      <section className="component-history" aria-label="Component state history" tabIndex={0}>{data.history.length ? data.history.map((entry) => <article key={entry.id}><strong>{entry.previousState} → {entry.newState}</strong><small>{entry.causeType === "standing-claim" ? "Operator status" : entry.causeType.replaceAll("-", " ")} · {formatOperatorTime(entry.changedAt)}</small></article>) : <p>No status changes yet.</p>}</section>
      {data.corrections.length ? <section className="component-corrections" aria-label="Corrections"><h3>Corrections</h3>{data.corrections.map((correction) => <article key={correction.id}><strong>{correction.state}</strong><small>{formatOperatorTime(correction.startsAt)} to {formatOperatorTime(correction.endsAt)}</small><p>{correction.reason}</p></article>)}</section> : null}
    </> : null}
    <AvailabilityReport component={component} />
    <details className="component-correction"><summary>Correct a past period</summary><form className="component-correction-form" onSubmit={correct}>
      <p>Earlier entries stay. Times in {timezone}.</p>
      <label className="form-label">Correct state<select value={state} onChange={(event) => setState(event.target.value as ComponentState)}>{COMPONENT_STATES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <div className="component-editor-grid"><label className="form-label">Starts at<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="form-label">Ends at<input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div>
      <label className="form-label">Reason<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {mutationError && <FormError>{mutationError}</FormError>}
      <div className="drawer-actions"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save correction"}</Button></div>
    </form></details>
  </div>;
}
