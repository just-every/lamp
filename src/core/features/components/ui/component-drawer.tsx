import { useState, type FormEvent } from "react";

import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { ComponentHistoryView, ComponentView, ComponentsService } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Drawer } from "../../../app/client/ui/drawer";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { ErrorState, LoadingState, formatOperatorTime } from "../../../app/client/ui/states";

type ComponentGroup = Awaited<ReturnType<ComponentsService["listGroups"]>>[number];
type ComponentInput = Pick<ComponentView, "groupId" | "name" | "description" | "internal" | "displayOrder" | "note">;

export function ComponentEditorDrawer({ component, groups, defaultGroupId = null, defaultDisplayOrder, onClose, onSaved }: { component: ComponentView | null; groups: ComponentGroup[]; defaultGroupId?: string | null; defaultDisplayOrder: number; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState<ComponentInput>({
    groupId: component?.groupId ?? defaultGroupId,
    name: component?.name ?? "",
    description: component?.description ?? "",
    internal: component?.internal ?? false,
    displayOrder: component?.displayOrder ?? defaultDisplayOrder,
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
      if (isNew) await appApi("/api/app/components", { method: "POST", body: JSON.stringify(input) });
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
    <p className="drawer-copy">Components carry their public name, ordering, visibility, and operator state note. Their current public state remains derived from claims.</p>
    <form className="component-editor-form" onSubmit={save}>
      <label className="form-label">Component name<input required maxLength={120} value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} /></label>
      <label className="form-label">Description <span className="field-hint">Optional · shown publicly</span><textarea maxLength={280} value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} /></label>
      <label className="form-label">State note <span className="field-hint">Optional · 250 characters · shown beside public state</span><textarea maxLength={250} value={input.note} onChange={(event) => setInput({ ...input, note: event.target.value })} /></label>
      <div className="component-editor-grid"><label className="form-label">Group<select value={input.groupId ?? ""} onChange={(event) => setInput({ ...input, groupId: event.target.value || null })}><option value="">Ungrouped</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label className="form-label">Component order<input required type="number" min={0} step={1} value={input.displayOrder} onChange={(event) => setInput({ ...input, displayOrder: Number(event.target.value) })} /></label></div>
      <label className="checkbox-label component-internal-toggle"><input type="checkbox" checked={input.internal} onChange={(event) => setInput({ ...input, internal: event.target.checked })} />Internal only <small>Exclude this component from the status page, Atom feed, widget, overall status, and uptime.</small></label>
      {error && <ErrorState>{error}</ErrorState>}
      {!isNew && removalConfirmation && <p className="delete-confirmation">Delete this component? Its state history leaves the public page and uptime figures. Published incident and maintenance updates retain the recorded component name.</p>}
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
      setError(cause instanceof Error ? cause.message : "The standing claim could not be saved.");
      setSaving(false);
    }
  }

  return <Drawer eyebrow="Standing claim" title={component.name} onClose={onClose}>
    <p className="drawer-copy">Current public state: <strong>{component.publicState}</strong></p>
    <label className="form-label">Operator standing claim<select value={state} onChange={(event) => setState(event.target.value as ComponentState | "")}><option value="">No standing claim</option>{COMPONENT_STATES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
    <p className="drawer-explanation"><Icon name="warning" width={17} height={17} />Lamp derives the public state from the most severe active standing, unresolved published incident, and in-progress maintenance claim. A standing claim can still win when it is more severe.</p>
    {error && <ErrorState>{error}</ErrorState>}
    <div className="drawer-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save standing claim"}</Button></div>
  </Drawer>;
}

export function ComponentHistoryDrawer({ component, onClose, onSaved }: { component: ComponentView; onClose: () => void; onSaved: () => void }) {
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
      await appApi(`/api/app/components/${component.id}/history-corrections`, { method: "POST", body: JSON.stringify({ state, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), reason }) });
      setReason(""); setStartsAt(""); setEndsAt(""); refresh(); onSaved(); setSaving(false);
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "The correction could not be recorded.");
      setSaving(false);
    }
  }

  return <Drawer eyebrow="State history" title={component.name} onClose={onClose}>
    <p className="drawer-copy">History is append-only. A correction records a closed interval, reason, and operator; it never alters an earlier entry.</p>
    {loading ? <LoadingState /> : error ? <ErrorState>{error}</ErrorState> : <><section className="component-history" aria-label="Component state history">{data?.history.length ? data.history.map((entry) => <article key={entry.id}><strong>{entry.previousState} → {entry.newState}</strong><small>{entry.causeType.replaceAll("-", " ")} · {formatOperatorTime(entry.changedAt)}</small></article>) : <p>No derived state changes are recorded yet.</p>}</section>
      {data?.corrections.length ? <section className="component-corrections" aria-label="Recorded corrections"><h3>Recorded corrections</h3>{data.corrections.map((correction) => <article key={correction.id}><strong>{correction.state}</strong><small>{formatOperatorTime(correction.startsAt)} to {formatOperatorTime(correction.endsAt)}</small><p>{correction.reason}</p></article>)}</section> : null}</>}
    <form className="component-correction-form" onSubmit={correct}><h3>Correct a closed interval</h3><label className="form-label">Correct state<select value={state} onChange={(event) => setState(event.target.value as ComponentState)}>{COMPONENT_STATES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><div className="component-editor-grid"><label className="form-label">Starts at<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="form-label">Ends at<input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div><label className="form-label">Reason<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{mutationError && <ErrorState>{mutationError}</ErrorState>}<div className="drawer-actions"><Button type="button" variant="secondary" onClick={onClose}>Close</Button><Button type="submit" disabled={saving}>{saving ? "Recording…" : "Record correction"}</Button></div></form>
  </Drawer>;
}
