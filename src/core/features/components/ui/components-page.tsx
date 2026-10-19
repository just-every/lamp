import { AvailabilityReport } from "../../availability-reports/ui/availability-report";
import { useState } from "react";

import type { ComponentsService } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { LoadingState, FormError } from "../../../app/client/ui/states";
import { EmptyState, ErrorState } from "../../../app/client/ui/lit-states";
import { ComponentEditorDrawer, ComponentHistoryDrawer, StandingClaimDrawer } from "./component-drawer";
import { CatalogueDrawer } from "./catalogue-drawer";
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
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [groupPanel, setGroupPanel] = useState<GroupPanel | null>(null);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!data) return null;

  const groups = groupedComponents(data.groups, data.components);
  const nextComponentOrder = Math.max(0, ...data.components.map((component) => component.displayOrder + 1));
  const nextGroupOrder = Math.max(0, ...data.groups.map((group) => group.displayOrder + 1));
  const closeAndRefresh = () => { setComponentPanel(null); setGroupPanel(null); refresh(); };

  const moveComponent = async (component: Component, direction: number) => {
    const siblings = data.components.filter((item) => item.groupId === component.groupId);
    const index = siblings.findIndex((item) => item.id === component.id);
    const adjacent = siblings[index + direction];
    if (!adjacent || moving) return;
    setMoving(true); setMoveError(null);
    try {
      await appApi(`/api/app/components/${component.id}/move`, { method: "POST", body: JSON.stringify({ direction: direction < 0 ? "up" : "down", expectedIds: siblings.map(item => item.id), groupId: component.groupId }) });
      refresh();
    } catch (cause) { setMoveError((cause as Error).message); }
    finally { setMoving(false); }
  };
  const moveGroup = async (group: Group, direction: number) => {
    const index = data.groups.findIndex((item) => item.id === group.id);
    const adjacent = data.groups[index + direction]; if (!adjacent || moving) return;
    setMoving(true); setMoveError(null);
    try {
      await appApi(`/api/app/component-groups/${group.id}/move`, { method: "POST", body: JSON.stringify({ direction: direction < 0 ? "up" : "down", expectedIds: data.groups.map(item => item.id) }) });
      refresh();
    } catch (cause) { setMoveError((cause as Error).message); }
    finally { setMoving(false); }
  };

  return <div className="page-stack components-page">
    <section className="page-title-row component-title-row"><div><p className="eyebrow">Public services</p><h1>Components</h1><p>Organize services and set their status. Active incidents and maintenance can raise a service’s public status.</p></div><div className="component-title-actions"><Button variant="secondary" type="button" onClick={() => setBulkOpen(true)}>Bulk edit / import CSV</Button><Button variant="secondary" type="button" onClick={() => setGroupPanel({ kind: "create-group" })}>Add group</Button><Button type="button" onClick={() => setComponentPanel({ kind: "create-component", groupId: null })}>Add component</Button></div></section>
    {moveError ? <FormError>{moveError}</FormError> : null}
    <section className="limit-note"><Icon name="warning" width={17} height={17} />Published incident and maintenance updates retain a removed component’s recorded name. A state correction appends history and records its reason.</section>
    {groups.length ? <section className="component-groups">{groups.map((group) => <ComponentGroupCard key={group.key} group={group} moving={moving} onMoveComponent={moveComponent} onMoveGroup={moveGroup} firstGroup={data.groups[0]?.id === group.group?.id} lastGroup={data.groups.at(-1)?.id === group.group?.id} onCreateComponent={() => setComponentPanel({ kind: "create-component", groupId: group.group?.id ?? null })} onEditGroup={() => group.group && setGroupPanel({ kind: "edit-group", group: group.group })} onEditComponent={(component) => setComponentPanel({ kind: "edit-component", component })} onStandingClaim={(component) => setComponentPanel({ kind: "standing-claim", component })} onHistory={(component) => setComponentPanel({ kind: "history", component })} />)}</section> : <EmptyState>No components are configured. Add the first component before creating an incident.</EmptyState>}
    <AvailabilityReport components={data.components} />
    {bulkOpen && <CatalogueDrawer onClose={() => setBulkOpen(false)} onSaved={() => { setBulkOpen(false); refresh(); }} />}
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

function ComponentGroupCard({ moving, onMoveComponent, onMoveGroup, firstGroup, lastGroup, group, onCreateComponent, onEditGroup, onEditComponent, onStandingClaim, onHistory }: { moving: boolean; onMoveComponent: (component: Component, direction: number) => void; onMoveGroup: (group: Group, direction: number) => void; firstGroup: boolean; lastGroup: boolean; group: ComponentGroup; onCreateComponent: () => void; onEditGroup: () => void; onEditComponent: (component: Component) => void; onStandingClaim: (component: Component) => void; onHistory: (component: Component) => void }) {
  return <article className="data-card component-group-card"><div className="card-heading component-group-heading"><div><p className="card-kicker">Component group</p><h2>{group.name}</h2><p>{group.group ? "Public service group" : "Components without a public group"}</p></div><div className="component-group-actions"><span className="count-label">{group.components.length} recorded</span>{group.group && <><Button type="button" variant="secondary" disabled={moving || firstGroup} aria-label={`Move ${group.name} up`} onClick={() => onMoveGroup(group.group!, -1)}>Move up</Button><Button type="button" variant="secondary" disabled={moving || lastGroup} aria-label={`Move ${group.name} down`} onClick={() => onMoveGroup(group.group!, 1)}>Move down</Button></>}{group.group && <Button variant="secondary" type="button" className="table-action" onClick={onEditGroup}>Edit group</Button>}<Button variant="secondary" type="button" className="table-action" onClick={onCreateComponent}>Add component</Button></div></div><div className="component-rows">{group.components.length ? group.components.map((component, index) => <ComponentRow moving={moving} first={index === 0} last={index === group.components.length - 1} onMove={(direction) => onMoveComponent(component, direction)} key={component.id} component={component} onEdit={() => onEditComponent(component)} onStandingClaim={() => onStandingClaim(component)} onHistory={() => onHistory(component)} />) : <p className="empty-component-group">No components in this group yet.</p>}</div></article>;
}

function ComponentRow({ moving, first, last, onMove, component, onEdit, onStandingClaim, onHistory }: { moving: boolean; first: boolean; last: boolean; onMove: (direction: number) => void; component: Component; onEdit: () => void; onStandingClaim: () => void; onHistory: () => void }) {
  return <article className="component-row"><div className="component-row-summary"><strong>{component.name}</strong><small>{component.description || "No description recorded."}</small><div className="component-row-metadata">{component.internal && <span className="state-pill">Internal only</span>}{component.note && <span>Note: {component.note}</span>}</div><ClientExtensionSlot id="component.row.actions.v1" context={{ component: { id: component.id, name: component.name, publicState: component.publicState, groupName: component.groupName } }} /></div><div className="component-row-actions"><Button type="button" variant="secondary" disabled={moving || first} aria-label={`Move ${component.name} up`} onClick={() => onMove(-1)}>Move up</Button><Button type="button" variant="secondary" disabled={moving || last} aria-label={`Move ${component.name} down`} onClick={() => onMove(1)}>Move down</Button><Button type="button" variant="secondary" className="table-action" onClick={onEdit}>Edit component</Button><Button type="button" variant="secondary" className="table-action" onClick={onStandingClaim}>Set status</Button><Button type="button" variant="secondary" className="table-action" onClick={onHistory}>Status history</Button></div><span className={`state-pill state-${component.publicState.toLowerCase().replaceAll(" ", "-")}`}>{component.publicState}</span></article>;
}
