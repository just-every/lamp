import type { ComponentsService } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { publicStateSource } from "./public-state-source";

type Component = Awaited<ReturnType<ComponentsService["list"]>>[number];
type Group = Awaited<ReturnType<ComponentsService["listGroups"]>>[number];
type Section = { key: string; name: string; components: Component[] };

/** Each group is a plain heading with its count over one white plate of rows; "Ungrouped" is named only beside named
 * groups. Groups, their names and order are edited in Edit all. */
export function ComponentGroups({ groups, components, openId, onOpen }: { groups: Group[]; components: Component[]; openId: string | null; onOpen: (component: Component) => void }) {
  const ungrouped = components.filter((component) => component.groupId === null);
  const sections: Section[] = [
    ...groups.map((group) => ({ key: group.id, name: group.name, components: components.filter((component) => component.groupId === group.id) })),
    ...(ungrouped.length ? [{ key: "ungrouped", name: "Ungrouped", components: ungrouped }] : []),
  ];
  if (!sections.length) return null;
  return <div className="component-groups">{sections.map((section) => <div key={section.key} className="component-group">
    {groups.length > 0 && <h2 className="component-group-heading">{section.name} <span className="component-group-count">{section.components.length}<span className="sr-only"> {section.components.length === 1 ? "component" : "components"}</span></span></h2>}
    {section.components.length
      ? <ul className="data-card component-rows">{section.components.map((component) => <ComponentRow key={component.id} component={component} open={component.id === openId} onOpen={() => onOpen(component)} />)}</ul>
      : <p className="data-card empty-component-group">No components in this group yet.</p>}
  </div>)}</div>;
}

/** One button per row opens the component's drawer; the extension slot sits beside it, never inside it. */
function ComponentRow({ component, open, onOpen }: { component: Component; open: boolean; onOpen: () => void }) {
  const source = publicStateSource(component);
  const facts = [component.description, component.internal ? "Internal only" : "", component.note ? `Note: ${component.note}` : "", source === "maintenance" ? "Maintenance in progress" : source === "incident" ? "Open incident" : ""].filter(Boolean);
  return <li className={open ? "component-row is-open" : "component-row"}>
    <button type="button" className="component-row-button" aria-haspopup="dialog" onClick={onOpen}>
      <span className="component-row-summary"><strong>{component.name}</strong>{facts.length > 0 && <small>{facts.join(" · ")}</small>}</span>
      <span className={`state-pill state-${component.publicState.toLowerCase().replaceAll(" ", "-")}`}>{component.publicState}</span>
      <svg className="row-chevron" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
    </button>
    <ClientExtensionSlot id="component.row.actions.v1" context={{ component: { id: component.id, name: component.name, publicState: component.publicState, groupName: component.groupName } }} />
  </li>;
}
