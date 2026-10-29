import { Button } from "../../../app/client/ui/button";
import type { PageTheme } from "../../../shared/page-theme";

export function ThemeLinks({ title, value, onChange }: {
  title: "Header" | "Footer"; value: PageTheme["headerLinks"]; onChange: (links: PageTheme["headerLinks"]) => void;
}) {
  function edit(index: number, field: "label" | "href", next: string) {
    onChange(value.map((link, position) => position === index ? { ...link, [field]: next } : link));
  }
  return <div className="page-stack">
    <h3>{title} links</h3>
    {value.map((link, index) => <div className="page-stack" key={index}>
      <div className="settings-grid">
        <label className="form-label">{title} link {index + 1} label<input value={link.label} onChange={event => edit(index, "label", event.target.value)} /></label>
        <label className="form-label">{title} link {index + 1} address<input type="text" inputMode="url" placeholder="https://example.com or /path" value={link.href} onChange={event => edit(index, "href", event.target.value)} /></label>
      </div>
      <div><Button type="button" variant="secondary" onClick={() => onChange(value.filter((_, position) => position !== index))}>Remove {title.toLowerCase()} link {index + 1}</Button></div>
    </div>)}
    <div><Button type="button" variant="secondary" onClick={() => onChange([...value, { label: "", href: "" }])}>Add {title.toLowerCase()} link</Button></div>
  </div>;
}
