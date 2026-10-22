import { UNGROUPED_COMPONENTS_HEADING } from "../../../shared/component-order";
import { EditableRow } from "./editable-row";
import type { FoundPage } from "./found-card";

const lines = (value: string) => value.split("\n").map((name) => name.trimStart()).slice(0, 200);
const kept = (names: string[]) => names.map((name) => name.trim()).filter(Boolean);

/** The page's components as the public page will list them: each group's in its order, then the rest. */
export function foundLayout(page: FoundPage) {
  return { components: kept(page.components), groups: page.groups.map((group) => ({ name: group.name, components: kept(group.components) })).filter((group) => group.components.length) };
}

function List({ names }: { names: string[] }) {
  return <ul className="found-components">{names.map((name, index) => <li key={index}>{name}</li>)}</ul>;
}

/** Components: from the business's own status page when it has one (its groups kept, labelled with where they came
 * from), otherwise from the site's navigation. Edited one per line, a list for each of the page's groups. */
export function FoundComponents({ page, onChange }: { page: FoundPage; onChange: (next: Partial<FoundPage>) => void }) {
  const layout = foundLayout(page);
  const count = layout.components.length + layout.groups.reduce((total, group) => total + group.components.length, 0);
  const label = page.existing ? `Components (${count} from ${page.existing.host})` : count ? `Components (${count} found)` : "Components";
  const grouped = page.groups.length > 0;
  const value = !count ? <span className="found-muted">None yet; add them any time</span>
    : grouped ? <div className="found-groups">{[...layout.groups, ...(layout.components.length ? [{ name: UNGROUPED_COMPONENTS_HEADING, components: layout.components }] : [])].map((group, index) => <div key={index}><p className="found-group">{group.name}</p><List names={group.components} /></div>)}</div>
    : <List names={layout.components} />;
  const hint = <small className="field-hint" id="first-run-components-help">One per line.</small>;
  const editor = grouped
    ? <><div className="found-groups-editor">
      {page.groups.map((group, index) => <div key={index} className="found-group-editor"><label className="form-label" htmlFor={`first-run-group-${index}`}>{group.name}</label><textarea id={`first-run-group-${index}`} rows={Math.max(2, group.components.length)} aria-describedby="first-run-components-help" value={group.components.join("\n")} onChange={(event) => onChange({ groups: page.groups.map((other, at) => at === index ? { ...other, components: lines(event.target.value) } : other) })} /></div>)}
      <div className="found-group-editor"><label className="form-label" htmlFor="first-run-components">{UNGROUPED_COMPONENTS_HEADING}</label><textarea id="first-run-components" rows={Math.max(2, page.components.length)} aria-describedby="first-run-components-help" value={page.components.join("\n")} onChange={(event) => onChange({ components: lines(event.target.value) })} /></div>
    </div>{hint}</>
    : <><textarea id="first-run-components" aria-label="Components" rows={Math.max(3, page.components.length)} aria-describedby="first-run-components-help" value={page.components.join("\n")} onChange={(event) => onChange({ components: lines(event.target.value) })} />{hint}</>;
  return <EditableRow label={label} name="components" value={value} editor={editor} />;
}
