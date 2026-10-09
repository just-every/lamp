import { useState } from "react";

import type { ComponentsService } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { EmptyState, ErrorState, LoadingState } from "../../../app/client/ui/states";
import { ComponentEditorDrawer, ComponentHistoryDrawer, StandingClaimDrawer } from "./component-drawer";
import { ComponentGroupDrawer } from "./component-group-drawer";

type ComponentsResponse = {
  components: Awaited<ReturnType<ComponentsService["list"]>>;
  groups: Awaited<ReturnType<ComponentsService["listGroups"]>>;
};
type Component = ComponentsResponse["components"][number];
type Group = ComponentsResponse["groups"][number];
type ComponentPanel = { kind: "create-component"; groupId: string | null } | { kind: "edit-component"; component: Component } | { kind: "standing-claim"; component: Component } | { kind: "history"; component: Component };
type GroupPanel = { kind: "create-group" } | { kind: "edit-group"; group: Group };

export function ComponentsPage() {
  const { data, error, loading, refresh } = useAppData<ComponentsResponse>("/api/app/components");
  const [componentPanel, setComponentPanel] = useState<ComponentPanel | null>(null);
  const [groupPanel, setGroupPanel] = useState<GroupPanel | null>(null);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;

  const groups = groupedComponents(data.groups, data.components);
  const nextComponentOrder = Math.max(0, ...data.components.map((component) => component.displayOrder + 1));
  const nextGroupOrder = Math.max(0, ...data.groups.map((group) => group.displayOrder + 1));
  const closeAndRefresh = () => { setComponentPanel(null); setGroupPanel(null); refresh(); };

  return <div className="page-stack components-page">
    <section className="page-title-row component-title-row"><div><p className="eyebrow">Derived public state</p><h1>Components</h1><p>Set public grouping, order, visibility, notes, and standing claims. Current state is always derived from active claims.</p></div><div className="component-title-actions"><Button variant="secondary" type="button" onClick={() => setGroupPanel({ kind: "create-group" })}>Add group</Button><Button type="button" onClick={() => setComponentPanel({ kind: "create-component", groupId: null })}>Add component</Button></div></section>
    <section className="limit-note"><Icon name="warning" width={17} height={17} />Published incident and maintenance updates retain a removed component’s recorded name. A state correction appends history and records its reason.</section>
    {groups.length ? <section className="component-groups">{groups.map((group) => <ComponentGroupCard key={group.key} group={group} onCreateComponent={() => setComponentPanel({ kind: "create-component", groupId: group.group?.id ?? null })} onEditGroup={() => group.group && setGroupPanel({ kind: "edit-group", group: group.group })} onEditComponent={(component) => setComponentPanel({ kind: "edit-component", component })} onStandingClaim={(component) => setComponentPanel({ kind: "standing-claim", component })} onHistory={(component) => setComponentPanel({ kind: "history", component })} />)}</section> : <EmptyState>No components are configured. Add the first component before creating an incident.</EmptyState>}
    {componentPanel?.kind === "create-component" && <ComponentEditorDrawer component={null} groups={data.groups} defaultGroupId={componentPanel.groupId} defaultDisplayOrder={nextComponentOrder} onClose={() => setComponentPanel(null)} onSaved={closeAndRefresh} />}
    {componentPanel?.kind === "edit-component" && <ComponentEditorDrawer component={componentPanel.component} groups={data.groups} defaultDisplayOrder={nextComponentOrder} onClose={() => setComponentPanel(null)} onSaved={closeAndRefresh} />}
    {componentPanel?.kind === "standing-claim" && <StandingClaimDrawer component={componentPanel.component} onClose={() => setComponentPanel(null)} onSaved={closeAndRefresh} />}
    {componentPanel?.kind === "history" && <ComponentHistoryDrawer component={componentPanel.component} onClose={() => setComponentPanel(null)} onSaved={closeAndRefresh} />}
    {groupPanel && <ComponentGroupDrawer group={groupPanel.kind === "edit-group" ? groupPanel.group : null} defaultDisplayOrder={nextGroupOrder} componentCount={groupPanel.kind === "edit-group" ? data.components.filter((component) => component.groupId === groupPanel.group.id).length : 0} onClose={() => setGroupPanel(null)} onSaved={closeAndRefresh} />}
  </div>;
}

type ComponentGroup = { key: string; name: string; group: Group | null; components: Component[] };

function groupedComponents(groups: Group[], components: Component[]): ComponentGroup[] {
  const knownGroups = groups.map((group) => ({ key: group.id, name: group.name, group, components: components.filter((component) => component.groupId === group.id) }));
  const ungrouped = components.filter((component) => component.groupId === null);
  return ungrouped.length ? [...knownGroups, { key: "ungrouped", name: "Ungrouped components", group: null, components: ungrouped }] : knownGroups;
}

function ComponentGroupCard({ group, onCreateComponent, onEditGroup, onEditComponent, onStandingClaim, onHistory }: { group: ComponentGroup; onCreateComponent: () => void; onEditGroup: () => void; onEditComponent: (component: Component) => void; onStandingClaim: (component: Component) => void; onHistory: (component: Component) => void }) {
  return <article className="data-card component-group-card"><div className="card-heading component-group-heading"><div><p className="card-kicker">Component group</p><h2>{group.name}</h2><p>{group.group ? `Public group order ${group.group.displayOrder}` : "Components without a public group"}</p></div><div className="component-group-actions"><span className="count-label">{group.components.length} recorded</span>{group.group && <Button variant="secondary" type="button" className="table-action" onClick={onEditGroup}>Edit group</Button>}<Button variant="secondary" type="button" className="table-action" onClick={onCreateComponent}>Add component</Button></div></div><div className="component-rows">{group.components.length ? group.components.map((component) => <ComponentRow key={component.id} component={component} onEdit={() => onEditComponent(component)} onStandingClaim={() => onStandingClaim(component)} onHistory={() => onHistory(component)} />) : <p className="empty-component-group">No components in this group yet.</p>}</div></article>;
}

function ComponentRow({ component, onEdit, onStandingClaim, onHistory }: { component: Component; onEdit: () => void; onStandingClaim: () => void; onHistory: () => void }) {
  return <article className="component-row"><div className="component-row-summary"><strong>{component.name}</strong><small>{component.description || "No description recorded."}</small><div className="component-row-metadata">{component.internal && <span>Internal only</span>}{component.note && <span>Note: {component.note}</span>}<span>Order {component.displayOrder}</span></div><ClientExtensionSlot id="component.row.actions.v1" context={{ component: { id: component.id, name: component.name, publicState: component.publicState, groupName: component.groupName } }} /></div><div className="component-row-actions"><Button type="button" variant="secondary" className="table-action" onClick={onEdit}>Edit component</Button><Button type="button" variant="secondary" className="table-action" onClick={onStandingClaim}>Standing claim</Button><Button type="button" variant="secondary" className="table-action" onClick={onHistory}>State history &amp; correction</Button></div><span className={`state-pill state-${component.publicState.toLowerCase().replaceAll(" ", "-")}`}>{component.publicState}</span></article>;
}
