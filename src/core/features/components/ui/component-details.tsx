import { useState, type FormEvent } from "react";

import type { ComponentView, ComponentsService } from "../service";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { mayLeave } from "../../../app/client/ui/leave-guard";
import { FormError } from "../../../app/client/ui/states";
import { usePageTimezone } from "../../../app/client/ui/timezone";
import { MetricsPanel } from "../../metrics/ui/metrics-panel";

type ComponentGroup = Awaited<ReturnType<ComponentsService["listGroups"]>>[number];
type ComponentInput = Pick<ComponentView, "groupId" | "name" | "description" | "region" | "internal" | "note" | "onlyShowIfDegraded" | "uptimeStartDate">;

/** Details: the component's edit form, and the whole drawer while a new component is created. */
export function ComponentDetails({ component, groups, defaultDisplayOrder, onCancel, onSaved }: { component: ComponentView | null; groups: ComponentGroup[]; defaultDisplayOrder: number; onCancel: () => void; onSaved: () => void }) {
  const timezone = usePageTimezone();
  const [input, setInput] = useState<ComponentInput>({
    groupId: component?.groupId ?? null,
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
    if (!await mayLeave()) return;
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

  return <>
    <form className="component-editor-form" onSubmit={save}>
      <label className="form-label">Component name<input required maxLength={120} value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} /></label>
      <label className="form-label">Description <span className="field-hint">Optional · shown publicly</span><textarea maxLength={500} value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} /></label>
      <label className="form-label">Region <span className="field-hint">Optional · shown publicly</span><input maxLength={80} list="component-region-options" value={input.region ?? ""} onChange={(event) => setInput({ ...input, region: event.target.value || null })} /><datalist id="component-region-options">{["North America", "South America", "Europe", "Africa", "Asia Pacific", "Middle East"].map(region => <option key={region} value={region} />)}</datalist><small>For the Regions map template.</small></label>
      <label className="form-label">Uptime start date<input type="date" value={input.uptimeStartDate ?? ""} onChange={(event) => setInput({ ...input, uptimeStartDate: event.target.value || null })} /><small>Uptime counts from this date in {timezone}.</small></label>
      <label className="checkbox-label"><input type="checkbox" checked={input.onlyShowIfDegraded} onChange={(event) => setInput({ ...input, onlyShowIfDegraded: event.target.checked })} />Show only when not Operational</label>
      <label className="form-label">State note <span className="field-hint">Optional · 250 characters · shown beside public state</span><textarea maxLength={250} value={input.note} onChange={(event) => setInput({ ...input, note: event.target.value })} /></label>
      <div className="component-editor-grid"><label className="form-label">Group<select value={input.groupId ?? ""} onChange={(event) => setInput({ ...input, groupId: event.target.value || null })}><option value="">Ungrouped</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
      <label className="checkbox-label"><input type="checkbox" checked={input.internal} onChange={(event) => setInput({ ...input, internal: event.target.checked })} />Hidden from the public page</label>
      {error && <FormError>{error}</FormError>}
      {!isNew && removalConfirmation && <p className="delete-confirmation">Delete this component? Its state history leaves the public page and uptime figures. Published updates keep its name.</p>}
      <div className="drawer-actions"><Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>{!isNew && <Button type="button" variant="secondary" className="danger-button" onClick={remove} disabled={saving}>{removalConfirmation ? "Confirm delete" : "Delete component"}</Button>}<Button type="submit" disabled={saving}>{saving ? "Saving…" : isNew ? "Create component" : "Save component"}</Button></div>
    </form>
    {component && <MetricsPanel componentId={component.id} />}
  </>;
}
