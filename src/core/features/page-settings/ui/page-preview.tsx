import { accentInk } from "../../../shared/accent-ink";
import { Icon } from "../../../app/client/ui/icon";

export interface PreviewComponent { name: string; state?: string }

const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/** Lamp's own small drawing of the public page from the same facts the page is built from. The live page
 * itself cannot be framed (PAGE-013), so onboarding, Your page and Settings show this beside an Open link. */
export function PagePreview({ pageName, accentColor, markSrc, components, address, size = "small" }: {
  pageName: string; accentColor: string; markSrc: string | null; components: PreviewComponent[]; address: string | null; size?: "small" | "large";
}) {
  const accent = isHex(accentColor) ? accentColor : "#182d24";
  const affected = components.find((component) => component.state && component.state !== "Operational");
  return <div className={`page-preview page-preview-${size}`} role="img" aria-label={`Preview of ${pageName}${address ? ` at ${address}` : ""}`}>
    <div className="page-preview-frame"><span /><span /><span />{address ? <small>{address}</small> : null}</div>
    <div className="page-preview-bar" style={{ background: accent, color: accentInk(accent) }}>
      {markSrc ? <img src={markSrc} alt="" /> : <span className="page-preview-letter">{pageName.trim().slice(0, 1).toUpperCase()}</span>}
      <strong>{pageName}</strong>
    </div>
    <div className="page-preview-body">
      <div className={`page-preview-state${affected ? " is-affected" : ""}`}>
        <span className="page-preview-check"><Icon name={affected ? "warning" : "check"} width={16} height={16} /></span>
        <span><strong>{affected ? affected.state : "Operational"}</strong><small>{affected ? "Some systems are affected." : "All systems are running normally."}</small></span>
      </div>
      {components.length ? <>
        <p className="page-preview-heading">Components</p>
        <ul>{components.map((component, index) => <li key={`${component.name}-${index}`}><span><i className={`page-preview-dot state-${(component.state ?? "Operational").toLowerCase().replaceAll(" ", "-")}`} />{component.name}</span><small>{component.state ?? "Operational"}</small></li>)}</ul>
      </> : <p className="page-preview-empty">Your components show here.</p>}
    </div>
  </div>;
}
