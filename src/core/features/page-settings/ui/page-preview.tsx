import { Fragment } from "react";
import { mostSevereState, type ComponentState } from "../../../shared/domain";
import { accentInk } from "../../../shared/accent-ink";
import { UNGROUPED_COMPONENTS_HEADING } from "../../../shared/component-order";
import { Icon } from "../../../app/client/ui/icon";

/** `group` names the component's group, in a list given in the page's order; a list without groups shows none. */
export interface PreviewComponent { name: string; state?: string; group?: string | null }

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/** Lamp's own small drawing of the public page from the same facts the page is built from. The live page
 * itself cannot be framed (PAGE-013), so onboarding, Your page and Settings show this beside an Open link. */
export function PagePreview({ pageName, accentColor, markSrc, components, address, size = "small" }: {
  pageName: string; accentColor: string; markSrc: string | null; components: PreviewComponent[]; address: string | null; size?: "small" | "large";
}) {
  const accent = isHex(accentColor) ? accentColor : "#182d24";
  const overall = mostSevereState(components.map(component => (component.state ?? "Operational") as ComponentState));
  const affected = overall !== "Operational";
  const grouped = components.some((component) => component.group);
  return <div className={`page-preview page-preview-${size}`} role="img" aria-label={`Preview of ${pageName}${address ? ` at ${address}` : ""}`}>
    <div className="page-preview-frame"><span /><span /><span />{address ? <small>{address}</small> : null}</div>
    <div className="page-preview-bar" style={{ background: accent, color: accentInk(accent) }}>
      {markSrc ? <img src={markSrc} alt="" /> : <span className="page-preview-letter">{pageName.trim().slice(0, 1).toUpperCase()}</span>}
      <strong>{pageName}</strong>
    </div>
    <div className="page-preview-body">
      <div className={`page-preview-state state-${overall.toLowerCase().replaceAll(" ", "-")}`}>
        <span className="page-preview-check"><Icon name={affected ? "warning" : "check"} width={16} height={16} /></span>
        <span><strong>{overall}</strong><small>{affected ? "Some systems are affected." : "All systems are running normally."}</small></span>
      </div>
      {components.length ? <>
        <p className="page-preview-heading">Components</p>
        <ul>{components.map((component, index) => <Fragment key={`${component.name}-${index}`}>
          {grouped && (index === 0 || component.group !== components[index - 1].group) ? <li className="page-preview-group">{component.group ?? UNGROUPED_COMPONENTS_HEADING}</li> : null}
          <li><span><i className={`page-preview-dot state-${(component.state ?? "Operational").toLowerCase().replaceAll(" ", "-")}`} />{component.name}</span><small className={`state-${(component.state ?? "Operational").toLowerCase().replaceAll(" ", "-")}`}>{component.state ?? "Operational"}</small></li>
        </Fragment>)}</ul>
      </> : <p className="page-preview-empty">Your components show here.</p>}
    </div>
  </div>;
}
