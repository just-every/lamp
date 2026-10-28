import { Button } from "../../../app/client/ui/button";
import type { PageTheme } from "../../../shared/page-theme";

type ThemeLinks = PageTheme["headerLinks"];

function LinkFields({ label, links, onChange }: { label: string; links: ThemeLinks; onChange: (links: ThemeLinks) => void }) {
  const update = (index: number, field: "label" | "href", next: string) => onChange(links.map((link, position) => position === index ? { ...link, [field]: next } : link));
  return <div className="theme-links">
    <h3>{label} links</h3>
    {links.map((link, index) => <div className="theme-link-row" key={index}>
      <label className="form-label">{label} link {index + 1} label<input value={link.label} onChange={event => update(index, "label", event.target.value)} /></label>
      <label className="form-label">{label} link {index + 1} address<input type="text" spellCheck={false} placeholder="https://example.com or /history" value={link.href} onChange={event => update(index, "href", event.target.value)} /></label>
      <Button type="button" variant="secondary" onClick={() => onChange(links.filter((_, position) => position !== index))}>Remove {label.toLowerCase()} link {index + 1}</Button>
    </div>)}
    <Button type="button" variant="secondary" onClick={() => onChange([...links, { label: "", href: "" }])}>Add {label.toLowerCase()} link</Button>
  </div>;
}

export function ThemeContent({ value, onChange }: { value: PageTheme; onChange: <K extends keyof PageTheme>(key: K, next: PageTheme[K]) => void }) {
  return <fieldset className="theme-fieldset"><legend>Header and footer</legend>
    <p>Links may use HTTPS or a path on your page. HTML is cleaned before publication; removed elements and attributes are listed after saving.</p>
    <LinkFields label="Header" links={value.headerLinks} onChange={next => onChange("headerLinks", next)} />
    <label className="form-label">Header HTML<textarea className="theme-code" rows={4} value={value.headerHtml} onChange={event => onChange("headerHtml", event.target.value)} /><small>Up to 8 KB. Use a, p, span, strong, em, br, ul, ol, li, nav and img. Images must use an uploaded image address.</small></label>
    <LinkFields label="Footer" links={value.footerLinks} onChange={next => onChange("footerLinks", next)} />
    <label className="form-label">Footer HTML<textarea className="theme-code" rows={4} value={value.footerHtml} onChange={event => onChange("footerHtml", event.target.value)} /><small>Up to 8 KB, with the same allowed elements and attributes as the header.</small></label>
  </fieldset>;
}
