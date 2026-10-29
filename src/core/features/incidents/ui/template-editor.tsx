import { useEffect, useState } from "react";
import { INCIDENT_LIFECYCLES } from "../../../shared/domain";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import type { IncidentTemplate } from "../template-repository";
import { TEMPLATE_WORDING_FIELDS, templateFieldsToShorten, type TemplateWordingField } from "../template-fields";
import { TemplateAutomationFields } from "./template-automation-fields";

export function TemplateEditor({ template, onSaved, onDirty, captureUpdate }: { template: IncidentTemplate; onSaved: (template: IncidentTemplate) => void; onDirty: (dirty: boolean) => void; captureUpdate: () => () => boolean }) {
  const [editing, setEditing] = useState(template);
  const [offset, setOffset] = useState(template.nextUpdateOffsetMinutes?.toString() ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setEditing(template); setOffset(template.nextUpdateOffsetMinutes?.toString() ?? ""); onDirty(false);
  }, [template, onDirty]);
  const fields = templateFieldsToShorten(editing);
  const offsetValid = offset === "" || (Number.isInteger(Number(offset)) && Number(offset) >= 1 && Number(offset) <= 10_080);
  const resolvedValid = !editing.resolvedUpdate || (!templateFieldsToShorten(editing.resolvedUpdate).length && editing.resolvedUpdate.affectedAudience.trim() && editing.resolvedUpdate.customerImpact.trim());
  const valid = !fields.length && editing.affectedAudience.trim() && editing.customerImpact.trim() && offsetValid && resolvedValid;
  const change = (field: TemplateWordingField | "lifecycle", value: string) => {
    setEditing(current => ({ ...current, [field]: value })); onDirty(true); setMessage(null);
  };
  const save = async () => {
    if (!valid || saving) return;
    const isCurrent = captureUpdate(); setSaving(true);
    try {
      const { lifecycle, affectedAudience, customerImpact, whatStillWorks, details, channels, resolvedUpdate } = editing;
      const response = await appApi<{ template: IncidentTemplate }>(`/api/app/incident-templates/${template.id}`, {
        method: "PUT", body: JSON.stringify({ lifecycle, affectedAudience, customerImpact, whatStillWorks, details, channels, resolvedUpdate, nextUpdateOffsetMinutes: offset === "" ? null : Number(offset) }),
      });
      if (!isCurrent()) return;
      onSaved(response.template); onDirty(false); setMessage("Template changes saved.");
    } catch (cause) { if (isCurrent()) setMessage(cause instanceof Error ? cause.message : "Template could not be updated."); }
    finally { if (isCurrent()) setSaving(false); }
  };
  return <section className="context-section" aria-label="Selected template editor">
    <h3>Edit selected template</h3>
    <dl><div><dt>Template title</dt><dd>{template.title || "No title"}</dd></div><div><dt>Template folder</dt><dd>{template.folder || "No folder"}</dd></div><div><dt>Notification default</dt><dd>{template.shouldSendNotifications === null ? "Use current channel selection" : template.shouldSendNotifications ? "Notify on available channels" : "No notifications"}</dd></div></dl>
    <label className="form-label">Template status<select aria-label="Template status" disabled={saving} value={editing.lifecycle} onChange={event => change("lifecycle", event.target.value)}>{INCIDENT_LIFECYCLES.map(lifecycle => <option key={lifecycle}>{lifecycle}</option>)}</select></label>
    {(Object.keys(TEMPLATE_WORDING_FIELDS) as TemplateWordingField[]).map(field => {
      const { label, max } = TEMPLATE_WORDING_FIELDS[field];
      return <label key={field} className="form-label">{label}<textarea aria-label={`Template ${label.toLowerCase()}`} value={editing[field]} disabled={saving} onChange={event => change(field, event.target.value)} aria-invalid={editing[field].length > max} /><span className="character-count">{editing[field].length}/{max}</span></label>;
    })}
    <label className="form-label">Template next update offset (minutes)<input aria-label="Template next update offset in minutes" type="number" disabled={saving} min="1" max="10080" value={offset} onChange={event => { setOffset(event.target.value); onDirty(true); setMessage(null); }} /><small>Leave empty to choose the next update time in the composer.</small></label>
    <TemplateAutomationFields channels={editing.channels} resolvedUpdate={editing.resolvedUpdate} disabled={saving} onChannels={channels => { setEditing(current => ({ ...current, channels })); onDirty(true); setMessage(null); }} onResolved={resolvedUpdate => { setEditing(current => ({ ...current, resolvedUpdate })); onDirty(true); setMessage(null); }} />
    {!resolvedValid ? <p role="alert">Complete the Resolved audience and customer impact within the wording limits.</p> : null}
    {fields.length ? <div role="alert"><p>Shorten these fields before applying this template:</p><ul>{fields.map(field => <li key={field}>{TEMPLATE_WORDING_FIELDS[field].label}: {editing[field].length} characters; limit {TEMPLATE_WORDING_FIELDS[field].max}.</li>)}</ul></div> : null}
    {!offsetValid ? <p role="alert">Choose an offset between 1 minute and 7 days, or leave it empty.</p> : null}
    <Button type="button" variant="secondary" onClick={save} disabled={!valid || saving}>Save template changes</Button>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
