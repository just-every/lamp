import { useState, type FormEvent } from "react";

import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { ComponentHistoryView, ComponentView, ComponentsService } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Drawer } from "../../../app/client/ui/drawer";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { LoadingState, useOperatorTime, FormError } from "../../../app/client/ui/states";

import { usePageTimezone, fromPageDateTime } from "../../../app/client/ui/timezone";

type ComponentGroup = Awaited<ReturnType<ComponentsService["listGroups"]>>[number];
type ComponentInput = Pick<ComponentView, "groupId" | "name" | "description" | "region" | "internal" | "note" | "onlyShowIfDegraded" | "uptimeStartDate">;

export function ComponentEditorDrawer({ component, groups, defaultGroupId = null, defaultDisplayOrder, onClose, onSaved }: { component: ComponentView | null; groups: ComponentGroup[]; defaultGroupId?: string | null; defaultDisplayOrder: number; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState<ComponentInput>({
    groupId: component?.groupId ?? defaultGroupId,
    name: component?.name ?? "",
    description: component?.description ?? "",
    region: component?.region ?? null,
    internal: component?.internal ?? false,
    onlyShowIfDegraded: component?.onlyShowIfDegraded ?? false,
    uptimeStartDate: component?.uptimeStartDate ?? null,
    note: component?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [removalConfirmation, setRemovalConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = component === null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(null);
    try {
      if (isNew) await appApi("/api/app/components", { method: "POST", body: JSON.stringify({ ...input, displayOrder: defaultDisplayOrder }) });
      else await appApi(`/api/app/components/${component.id}`, { method: "PUT", body: JSON.stringify(input) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The component could not be saved.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!component) return;
    if (!removalConfirmation) { setRemovalConfirmation(true); return; }
    setSaving(true); setError(null);
    try {
      await appApi(`/api/app/components/${component.id}`, { method: "DELETE" });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The component could not be deleted.");
      setSaving(false);
    }
  }

  return <Drawer eyebrow={isNew ? "New component" : "Component settings"} title={isNew ? "Add component" : component.name} onClose={onClose}>
    <p className="drawer-copy">Components carry their public name, ordering, visibility, and operator state note. Active incidents and maintenance may raise their public status.</p>
    <form className="component-editor-form" onSubmit={save}>
      <label className="form-label">Component name<input required maxLength={120} value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} /></label>
      <label className="form-label">Description <span className="field-hint">Optional · shown publicly</span><textarea maxLength={500} value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} /></label>
      <label className="form-label">Region <span className="field-hint">Optional · shown publicly</span><input maxLength={80} list="component-region-options" value={input.region ?? ""} onChange={(event) => setInput({ ...input, region: event.target.value || null })} /><datalist id="component-region-options">{["North America", "South America", "Europe", "Africa", "Asia Pacific", "Middle East"].map(region => <option key={region} value={region} />)}</datalist><small>Group this component by location in the Regions map template.</small></label>
      <label className="form-label">Uptime start date<input type="date" value={input.uptimeStartDate ?? ""} onChange={(event) => setInput({ ...input, uptimeStartDate: event.target.value || null })} /><small>Only show uptime from this date in the page's timezone. Earlier state history is kept.</small></label>
      <label className="checkbox-label"><input type="checkbox" checked={input.onlyShowIfDegraded} onChange={(event) => setInput({ ...input, onlyShowIfDegraded: event.target.checked })} />Show only when not Operational</label>
      <label className="form-label">State note <span className="field-hint">Optional · 250 characters · shown beside public state</span><textarea maxLength={250} value={input.note} onChange={(event) => setInput({ ...input, note: event.target.value })} /></label>
      <div className="component-editor-grid"><label className="form-label">Group<select value={input.groupId ?? ""} onChange={(event) => setInput({ ...input, groupId: event.target.value || null })}><option value="">Ungrouped</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
      <label className="checkbox-label component-internal-toggle"><input type="checkbox" checked={input.internal} onChange={(event) => setInput({ ...input, internal: event.target.checked })} /><span>Internal only</span> <small>Exclude this component from the status page, Atom feed, widget, overall status, and uptime.</small></label>
      {error && <FormError>{error}</FormError>}
      {!isNew && removalConfirmation && <p className="delete-confirmation">Delete this component? Its state history leaves the public page and uptime figures. Published updates keep its name.</p>}
      <div className="drawer-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>{!isNew && <Button type="button" variant="secondary" className="danger-button" onClick={remove} disabled={saving}>{removalConfirmation ? "Confirm delete" : "Delete component"}</Button>}<Button type="submit" disabled={saving}>{saving ? "Saving…" : isNew ? "Create component" : "Save component"}</Button></div>
    </form>
  </Drawer>;
}

export function StandingClaimDrawer({ component, onClose, onSaved }: { component: ComponentView; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState<ComponentState | "">(component.standingClaimState ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return <Drawer eyebrow="Set status" title={component.name} onClose={onClose}>
    <p className="drawer-copy">Current public state: <strong>{component.publicState}</strong></p>
    <label className="form-label">Service status<select value={state} onChange={(event) => setState(event.target.value as ComponentState | "")}><option value="">Automatic (Operational unless affected)</option>{COMPONENT_STATES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
    <p className="drawer-explanation"><Icon name="warning" width={17} height={17} />The public status is the most severe of this setting, active incidents, and maintenance in progress. Choose Automatic to clear this setting.</p>
    {error && <FormError>{error}</FormError>}
    <div className="drawer-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save status"}</Button></div>
  </Drawer>;
}

export function ComponentHistoryDrawer({ component, onClose, onSaved }: { component: ComponentView; onClose: () => void; onSaved: () => void }) {
  const formatOperatorTime = useOperatorTime();
  const timezone = usePageTimezone();
  const { data, error, loading, refresh } = useAppData<ComponentHistoryView>(`/api/app/components/${component.id}/history`);
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
      setReason(""); setStartsAt(""); setEndsAt(""); refresh(); onSaved(); setSaving(false);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "The correction could not be saved.");
      setSaving(false);
    }
  }

  return <Drawer eyebrow="Status history" title={component.name} onClose={onClose}>
    <p className="drawer-copy">Corrections add the right status for a past period, who changed it and why. Earlier entries stay.</p>
    {loading ? <LoadingState /> : error ? <FormError>{error}</FormError> : <><section className="component-history" aria-label="Component state history">{data?.history.length ? data.history.map((entry) => <article key={entry.id}><strong>{entry.previousState} → {entry.newState}</strong><small>{entry.causeType === "standing-claim" ? "Operator status" : entry.causeType.replaceAll("-", " ")} · {formatOperatorTime(entry.changedAt)}</small></article>) : <p>No status changes yet.</p>}</section>
      {data?.corrections.length ? <section className="component-corrections" aria-label="Corrections"><h3>Corrections</h3>{data.corrections.map((correction) => <article key={correction.id}><strong>{correction.state}</strong><small>{formatOperatorTime(correction.startsAt)} to {formatOperatorTime(correction.endsAt)}</small><p>{correction.reason}</p></article>)}</section> : null}</>}
    <form className="component-correction-form" onSubmit={correct}><h3>Correct a past period</h3><p>Times in {timezone}.</p><label className="form-label">Correct state<select value={state} onChange={(event) => setState(event.target.value as ComponentState)}>{COMPONENT_STATES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><div className="component-editor-grid"><label className="form-label">Starts at<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="form-label">Ends at<input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div><label className="form-label">Reason<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{mutationError && <FormError>{mutationError}</FormError>}<div className="drawer-actions"><Button type="button" variant="secondary" onClick={onClose}>Close</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save correction"}</Button></div></form>
  </Drawer>;
}
