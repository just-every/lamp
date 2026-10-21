import type { PageSettingsInput } from "../../../shared/schemas";

type Template = NonNullable<PageSettingsInput["template"]>;
// Only implemented templates belong here. A generated house style can join this list later.
const templates: Array<{ value: Template; name: string; description: string }> = [
  { value: "default", name: "Default", description: "The original Lamp status page." },
  { value: "calm", name: "Calm headline", description: "One quiet sentence, with components and history beneath it." },
  { value: "uptime", name: "Uptime-history-led", description: "Overall uptime and a shared 90-day component history." },
  { value: "regions", name: "Regions map", description: "A world map and region filters for your components." },
];

export function TemplateChoice({ value, showing, regionsAvailable, onChange }: {
  value: Template; showing: Template; regionsAvailable: boolean; onChange: (value: Template) => void;
}) {
  const shown = templates.find(template => template.value === showing)!;
  return <section className="data-card" aria-labelledby="template-title">
    <p className="card-kicker" id="template-title">Template</p>
    <p role="status">{showing === "regions" && !regionsAvailable
      ? "Showing Calm headline: you chose Regions map, and it needs public components in at least two regions."
      : `Showing ${shown.name}: ${showing === "default" ? "it is your saved default" : "you chose it"}.`}</p>
    <label className="form-label">Template<select value={value} onChange={event => onChange(event.target.value as Template)} aria-describedby="template-description template-regions-reason">
      {templates.map(template => <option key={template.value} value={template.value} disabled={template.value === "regions" && !regionsAvailable && showing !== "regions"}>{template.name}</option>)}
    </select><small id="template-description">{templates.find(template => template.value === value)?.description} Save settings to publish your choice.</small></label>
    <p id="template-regions-reason">{regionsAvailable ? "Regions map is available: your public components are in more than one region." : "Regions map needs public components in at least two regions. Give your components a region in the component editor to use it."}</p>
  </section>;
}
