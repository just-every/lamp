import { useState } from "react";
import type { UpdateChannel } from "../../../shared/domain";
import type { IncidentDraftInput } from "../../../shared/schemas";
import type { IncidentTemplate } from "../template-repository";
import type { AppliedIncidentTemplate } from "../template-service";
import type { IncidentView } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { TemplateEditor } from "./template-editor";

export function TemplateControls({ incident, draft, onApplied, onChannelsApplied, version, captureUpdate }: {
  incident: IncidentView; draft: IncidentDraftInput; onApplied: (draft: IncidentDraftInput, storedId?: string) => void;
  onChannelsApplied: (channels: UpdateChannel[]) => void; version: string; captureUpdate: () => () => boolean;
}) {
  const { data, refresh } = useAppData<{ templates: IncidentTemplate[] }>("/api/app/incident-templates");
  const [name, setName] = useState(""); const [offset, setOffset] = useState("60"); const [selected, setSelected] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [editedTemplate, setEditedTemplate] = useState<IncidentTemplate | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [applying, setApplying] = useState(false);
  const selectedTemplate = editedTemplate?.id === selected ? editedTemplate : data?.templates.find(template => template.id === selected);
  const save = async () => {
    const isCurrent = captureUpdate();
    try {
      await appApi("/api/app/incident-templates", { method: "POST", body: JSON.stringify({ name, lifecycle: draft.lifecycle, affectedAudience: draft.affectedAudience, customerImpact: draft.customerImpact, whatStillWorks: draft.whatStillWorks, details: draft.details, nextUpdateOffsetMinutes: Number(offset), components: [...incident.components.flatMap(component => component.componentId ? [{ componentId: component.componentId, state: draft.componentChanges?.find(change => change.componentId === component.componentId)?.state ?? component.state, relationship: component.relationship }] : []), ...(draft.componentChanges ?? []).filter(change => !incident.components.some(component => component.componentId === change.componentId)).map(change => ({ ...change, relationship: change.relationship ?? "Primary" }))] }) });
      if (!isCurrent()) return;
      setEditedTemplate(null); setMessage("Template saved."); setName(""); refresh();
    } catch (cause) { if (isCurrent()) setMessage(cause instanceof Error ? cause.message : "Template could not be saved."); }
  };
  const apply = async () => {
    if (!selectedTemplate || selectedTemplate.fieldsToShorten.length || editorDirty || applying) return;
    const isCurrent = captureUpdate(); setApplying(true);
    try {
      const response = await appApi<AppliedIncidentTemplate & { channels?: UpdateChannel[] }>(`/api/app/incidents/${incident.id}/templates/${selected}/apply`, { method: "POST", headers: { "If-Match": version } });
      if (!isCurrent()) return;
      const { lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt } = response.draft;
      const componentChanges = response.draft.componentChanges.map(({ componentId, state, relationship }) => ({ componentId, state, relationship }));
      onApplied({ lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt, componentChanges }, response.draft.id);
      if (response.channels !== undefined) onChannelsApplied(response.channels);
      setMessage(nextUpdateAt === null && lifecycle !== "Resolved" ? "Template filled the private draft. Choose the next update time before publishing." : "Template filled the private draft.");
    } catch (cause) { if (isCurrent()) setMessage(cause instanceof Error ? cause.message : "Template could not be applied."); }
    finally { if (isCurrent()) setApplying(false); }
  };
  return <section className="template-controls" aria-label="Update templates">
    <div><strong>Update templates</strong><p>Save this private draft and its affected components, or apply a saved template without publishing.</p></div>
    <div className="template-form"><label className="form-label">Template name<input aria-label="Template name" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Template name" /></label><label className="form-label">Next update offset (minutes)<input aria-label="Next update offset in minutes" type="number" min="1" max="10080" value={offset} onChange={event => setOffset(event.target.value)} /></label><Button type="button" variant="secondary" disabled={!name.trim()} onClick={save}>Save template</Button></div>
    {data?.templates.length ? <div className="template-form"><label className="form-label">Saved update template<select aria-label="Saved update template" value={selected} onChange={event => { setSelected(event.target.value); setEditedTemplate(null); setEditorDirty(false); setMessage(null); }}><option value="">Choose a saved template</option>{data.templates.map(template => <option key={template.id} value={template.id}>{template.folder ? `${template.folder} / ` : ""}{template.name}</option>)}</select></label><Button type="button" variant="secondary" disabled={!selectedTemplate || Boolean(selectedTemplate.fieldsToShorten.length) || editorDirty || applying} onClick={apply}>Apply template</Button></div> : null}
    {selectedTemplate ? <TemplateEditor key={selectedTemplate.id} template={selectedTemplate} captureUpdate={captureUpdate} onDirty={setEditorDirty} onSaved={template => { setEditedTemplate(template); refresh(); }} /> : null}
    {editorDirty ? <p>Save the template changes before applying.</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
