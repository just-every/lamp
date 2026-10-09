import { useState, type FormEvent } from "react";

import type { ComponentsService } from "../service";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Drawer } from "../../../app/client/ui/drawer";
import { ErrorState } from "../../../app/client/ui/states";

type ComponentGroup = Awaited<ReturnType<ComponentsService["listGroups"]>>[number];

export function ComponentGroupDrawer({ group, defaultDisplayOrder, componentCount, onClose, onSaved }: { group: ComponentGroup | null; defaultDisplayOrder: number; componentCount: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name ?? "");
  const [displayOrder, setDisplayOrder] = useState(group?.displayOrder ?? defaultDisplayOrder);
  const [saving, setSaving] = useState(false);
  const [removalConfirmation, setRemovalConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = group === null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      if (isNew) await appApi("/api/app/component-groups", { method: "POST", body: JSON.stringify({ name, displayOrder }) });
      else await appApi(`/api/app/component-groups/${group.id}`, { method: "PUT", body: JSON.stringify({ name, displayOrder }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The component group could not be saved.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!group) return;
    if (!removalConfirmation) { setRemovalConfirmation(true); return; }
    setSaving(true); setError(null);
    try {
      await appApi(`/api/app/component-groups/${group.id}`, { method: "DELETE" });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The component group could not be deleted.");
      setSaving(false);
    }
  }

  return <Drawer eyebrow={isNew ? "New component group" : "Group settings"} title={isNew ? "Add group" : group.name} onClose={onClose}><p className="drawer-copy">Group order is the public order. Removing a group keeps its {componentCount === 1 ? "component" : `${componentCount} components`} and makes {componentCount === 1 ? "it" : "them"} ungrouped.</p><form className="component-editor-form" onSubmit={save}><label className="form-label">Group name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="form-label">Group order<input required type="number" min={0} step={1} value={displayOrder} onChange={(event) => setDisplayOrder(Number(event.target.value))} /></label>{error && <ErrorState>{error}</ErrorState>}{!isNew && removalConfirmation && <p className="delete-confirmation">Delete this group and make its components ungrouped?</p>}<div className="drawer-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>{!isNew && <Button type="button" variant="secondary" className="danger-button" onClick={remove} disabled={saving}>{removalConfirmation ? "Confirm delete" : "Delete group"}</Button>}<Button type="submit" disabled={saving}>{saving ? "Saving…" : isNew ? "Create group" : "Save group"}</Button></div></form></Drawer>;
}
