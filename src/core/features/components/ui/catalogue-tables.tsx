import type { ComponentCatalogue } from "../catalogue-schema";
import { createUlid } from "../../../shared/ids";
import { Button } from "../../../app/client/ui/button";

type Component = ComponentCatalogue["components"][number];
type Group = ComponentCatalogue["groups"][number];

export function CatalogueTables({ catalogue, onChange, disabled = false }: { catalogue: ComponentCatalogue; onChange: (catalogue: ComponentCatalogue) => void; disabled?: boolean }) {
  const changeGroup = (id: string, patch: Partial<Group>) => onChange({ ...catalogue, groups: catalogue.groups.map(group => group.id === id ? { ...group, ...patch } : group) });
  const changeComponent = (id: string, patch: Partial<Component>) => onChange({ ...catalogue, components: catalogue.components.map(component => component.id === id ? { ...component, ...patch } : component) });
  const addGroup = () => onChange({ ...catalogue, groups: [...catalogue.groups, { id: createUlid(), name: "", displayOrder: Math.max(-1, ...catalogue.groups.map(group => group.displayOrder)) + 1 }] });
  const addComponent = () => onChange({ ...catalogue, components: [...catalogue.components, { id: createUlid(), name: "", description: "", groupId: null, displayOrder: Math.max(-1, ...catalogue.components.map(component => component.displayOrder)) + 1, note: "", internal: false, onlyShowIfDegraded: false, uptimeStartDate: null }] });
  return <fieldset className="catalogue-fields" disabled={disabled}>
    <section><div className="card-heading"><h3>Groups</h3><Button type="button" variant="secondary" onClick={addGroup}>Add group row</Button></div>
      <div className="catalogue-table-scroll"><table className="catalogue-table"><caption className="sr-only">Edit component groups</caption><thead><tr><th scope="col">Name</th><th scope="col">Position</th><th scope="col">Remove</th></tr></thead><tbody>{catalogue.groups.map((group, index) => <tr key={group.id}>
        <td><input aria-label={`Group ${index + 1} name`} maxLength={120} value={group.name} onChange={event => changeGroup(group.id, { name: event.target.value })} /></td>
        <td><input aria-label={`Group ${index + 1} position`} type="number" min={0} step={1} value={group.displayOrder} onChange={event => changeGroup(group.id, { displayOrder: Number(event.target.value) })} /></td>
        <td><Button variant="secondary" type="button" aria-label={`Remove group ${group.name || index + 1}`} onClick={() => onChange({ groups: catalogue.groups.filter(item => item.id !== group.id), components: catalogue.components.map(component => component.groupId === group.id ? { ...component, groupId: null } : component) })}>Remove</Button></td>
      </tr>)}</tbody></table></div>
    </section>
    <section><div className="card-heading"><h3>Components</h3><Button type="button" variant="secondary" onClick={addComponent}>Add component row</Button></div>
      <div className="catalogue-table-scroll"><table className="catalogue-table"><caption className="sr-only">Edit components</caption><thead><tr><th scope="col">Name and description</th><th scope="col">Group and position</th><th scope="col">Visibility and uptime</th><th scope="col">State note</th><th scope="col">Remove</th></tr></thead><tbody>{catalogue.components.map((component, index) => <tr key={component.id}>
        <td><label>Name<input aria-label={`Component ${index + 1} name`} maxLength={120} value={component.name} onChange={event => changeComponent(component.id, { name: event.target.value })} /></label><label>Description<textarea aria-label={`Component ${index + 1} description`} maxLength={500} value={component.description} onChange={event => changeComponent(component.id, { description: event.target.value })} /></label></td>
        <td><label>Group<select aria-label={`Component ${index + 1} group`} value={component.groupId ?? ""} onChange={event => changeComponent(component.id, { groupId: event.target.value || null })}><option value="">Ungrouped</option>{catalogue.groups.map(group => <option key={group.id} value={group.id}>{group.name || "Unnamed group"}</option>)}</select></label><label>Position<input aria-label={`Component ${index + 1} position`} type="number" min={0} step={1} value={component.displayOrder} onChange={event => changeComponent(component.id, { displayOrder: Number(event.target.value) })} /></label></td>
        <td><label className="checkbox-label"><input type="checkbox" aria-label={`Component ${index + 1} internal only`} checked={component.internal} onChange={event => changeComponent(component.id, { internal: event.target.checked })} />Internal only</label><label className="checkbox-label"><input type="checkbox" aria-label={`Component ${index + 1} show only when not Operational`} checked={component.onlyShowIfDegraded} onChange={event => changeComponent(component.id, { onlyShowIfDegraded: event.target.checked })} />Show only when not Operational</label><label>Uptime start date<input aria-label={`Component ${index + 1} uptime start date`} type="date" value={component.uptimeStartDate ?? ""} onChange={event => changeComponent(component.id, { uptimeStartDate: event.target.value || null })} /></label></td>
        <td><textarea aria-label={`Component ${index + 1} state note`} maxLength={250} value={component.note} onChange={event => changeComponent(component.id, { note: event.target.value })} /></td>
        <td><Button variant="secondary" type="button" aria-label={`Remove component ${component.name || index + 1}`} onClick={() => onChange({ ...catalogue, components: catalogue.components.filter(item => item.id !== component.id) })}>Remove</Button></td>
      </tr>)}</tbody></table></div>
    </section>
  </fieldset>;
}
