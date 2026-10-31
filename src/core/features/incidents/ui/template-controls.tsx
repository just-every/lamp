import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { IncidentDraftInput } from "../../../shared/schemas";
import type { IncidentTemplate } from "../template-repository";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { OptionPanel } from "./update-options";

type TemplateComponent = { componentId: string; state: string; relationship: "Primary" | "Dependent" };

/** UPDATE-009: fill the update from a saved template, or save this update and its components as one; nothing publishes.
 * "Use a template" and "Save as a template" each open their own panel under the Publish row. Editing a saved template
 * stays in Settings › Templates. */
export function TemplateControls({ draft, components, onApply, captureUpdate }: {
  draft: Pick<IncidentDraftInput, "lifecycle" | "affectedAudience" | "customerImpact" | "whatStillWorks" | "details">;
  components: TemplateComponent[];
  /** Fills the update from the template and returns what to tell the operator, or null when the visit moved on. */
  onApply: (template: IncidentTemplate, isCurrent: () => boolean) => Promise<string | null>;
  captureUpdate: () => () => boolean;
}) {
  const { data, refresh } = useAppData<{ templates: IncidentTemplate[] }>("/api/app/incident-templates");
  const [name, setName] = useState(""); const [offset, setOffset] = useState("60"); const [selected, setSelected] = useState("");
  const [message, setMessage] = useState<{ panel: "use" | "save"; text: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const selectedTemplate = data?.templates.find(template => template.id === selected);
  const save = async () => {
    const isCurrent = captureUpdate();
    try {
      await appApi("/api/app/incident-templates", { method: "POST", body: JSON.stringify({ name, lifecycle: draft.lifecycle, affectedAudience: draft.affectedAudience, customerImpact: draft.customerImpact, whatStillWorks: draft.whatStillWorks, details: draft.details, nextUpdateOffsetMinutes: Number(offset), components }) });
      if (!isCurrent()) return;
      setMessage({ panel: "save", text: "Template saved." }); setName(""); refresh();
    } catch (cause) { if (isCurrent()) setMessage({ panel: "save", text: cause instanceof Error ? cause.message : "Template could not be saved." }); }
  };
  const apply = async () => {
    if (!selectedTemplate || selectedTemplate.fieldsToShorten.length || applying) return;
    const isCurrent = captureUpdate(); setApplying(true);
    try {
      const result = await onApply(selectedTemplate, isCurrent);
      if (result !== null && isCurrent()) setMessage({ panel: "use", text: result });
    } catch (cause) { if (isCurrent()) setMessage({ panel: "use", text: cause instanceof Error ? cause.message : "Template could not be applied." }); }
    finally { if (isCurrent()) setApplying(false); }
  };
  return <>
    <OptionPanel name="template-use" title="Use a template">
      <div className="template-controls">
        {data?.templates.length ? <div className="template-form"><label className="form-label">Saved update template<select aria-label="Saved update template" value={selected} onChange={event => { setSelected(event.target.value); setMessage(null); }}><option value="">Choose a saved template</option>{data.templates.map(template => <option key={template.id} value={template.id}>{template.folder ? `${template.folder} / ` : ""}{template.name}</option>)}</select></label><Button type="button" variant="secondary" disabled={!selectedTemplate || Boolean(selectedTemplate.fieldsToShorten.length) || applying} onClick={apply}>Apply template</Button></div> : <p>No saved templates yet. Save an update as a template to reuse it here.</p>}
        {selectedTemplate?.fieldsToShorten.length ? <p>This template is too long to apply. <Link className="text-link" to="/app/settings" hash="templates">Shorten it in Settings › Templates</Link>.</p> : null}
        {message?.panel === "use" ? <p role="status">{message.text}</p> : null}
      </div>
    </OptionPanel>
    <OptionPanel name="template-save" title="Save as a template">
      <div className="template-controls">
        <div className="template-form"><label className="form-label">Template name<input aria-label="Template name" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Template name" /></label><label className="form-label">Next update offset (minutes)<input aria-label="Next update offset in minutes" type="number" min="1" max="10080" value={offset} onChange={event => setOffset(event.target.value)} /></label><Button type="button" variant="secondary" disabled={!name.trim()} onClick={save}>Save template</Button></div>
        {message?.panel === "save" ? <p role="status">{message.text}</p> : null}
      </div>
    </OptionPanel>
  </>;
}
