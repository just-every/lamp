import { useEffect, useState, type ReactNode } from "react";
import type { IncidentDraftInput } from "../../../shared/schemas";
import type { IncidentView } from "../service";
import type { CheckedSuggestion } from "../../ai/service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { useOperatorTime } from "../../../app/client/ui/states";

export function FieldNumber({ value, label, required, count, max, children }: { value: string; label: string; required?: boolean; count: number; max: number; children: ReactNode }) {
  return <label className="impact-field"><span className="field-label"><b>{value}</b>{label}{required && <em aria-hidden="true">*</em>}</span>{children}<span className="character-count">{count}/{max}</span></label>;
}

export function PreviewCard({ title, heading, lifecycle, fields }: { title: string; heading: string; lifecycle: string | null; fields: Array<{ label: string; value: string }> }) {
  return <section className="preview-card"><p className="preview-type">{title}</p>{lifecycle && <span className={`state-pill state-${lifecycle.toLowerCase()}`}>{lifecycle}</span>}<h3>{heading}</h3><dl>{fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>;
}

export function AiSuggestionButton({ incidentId, onSuggestion, captureUpdate }: { incidentId: string; onSuggestion: (checked: CheckedSuggestion) => void; captureUpdate: () => () => boolean }) {
  const { data } = useAppData<{ configured: boolean }>("/api/app/ai/status");
  const [message, setMessage] = useState<string | null>(null);
  if (!data?.configured) return null;
  const suggest = async () => { const isCurrent = captureUpdate(); setMessage("Drafting suggestion…"); try { const response = await appApi<CheckedSuggestion>(`/api/app/incidents/${incidentId}/ai-suggestion`, { method: "POST" }); if (!isCurrent()) return; onSuggestion(response); setMessage("Suggestion filled the editable text. Check each field against its source before you publish."); } catch (cause) { if (!isCurrent()) return; setMessage(cause instanceof Error ? cause.message : "Suggestion failed."); } };
  return <div className="ai-suggestion"><Button type="button" variant="secondary" onClick={suggest}>Suggest update</Button>{message ? <span role="status">{message}</span> : null}</div>;
}

type IncidentTemplate = { id: string; name: string; lifecycle: IncidentDraftInput["lifecycle"]; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateOffsetMinutes: number; components: Array<{ componentId: string | null; state: string; relationship: string }> };
export function TemplateControls({ incident, draft, onApplied, version, captureUpdate }: { incident: IncidentView; draft: IncidentDraftInput; onApplied: (draft: IncidentDraftInput, storedId?: string) => void; version: string; captureUpdate: () => () => boolean }) {
  const { data, refresh } = useAppData<{ templates: IncidentTemplate[] }>("/api/app/incident-templates");
  const [name, setName] = useState(""); const [offset, setOffset] = useState("60"); const [selected, setSelected] = useState(""); const [message, setMessage] = useState<string | null>(null);
  const save = async () => {
    const isCurrent = captureUpdate();
    const nextUpdateOffsetMinutes = Number(offset);
    try {
      await appApi("/api/app/incident-templates", { method: "POST", body: JSON.stringify({ name, lifecycle: draft.lifecycle, affectedAudience: draft.affectedAudience, customerImpact: draft.customerImpact, whatStillWorks: draft.whatStillWorks, details: draft.details, nextUpdateOffsetMinutes, components: incident.components.flatMap((component) => component.componentId ? [{ componentId: component.componentId, state: component.state, relationship: component.relationship }] : []) }) });
      if (!isCurrent()) return;
      setMessage("Template saved."); setName(""); refresh();
    } catch (cause) { if (!isCurrent()) return; setMessage(cause instanceof Error ? cause.message : "Template could not be saved."); }
  };
  const apply = async () => {
    if (!selected) return;
    const isCurrent = captureUpdate();
    try {
      const response = await appApi<{ draft: IncidentDraftInput & { id: string } }>(`/api/app/incidents/${incident.id}/templates/${selected}/apply`, { method: "POST", headers: { "If-Match": version } });
      if (!isCurrent()) return;
      // The template endpoint returns a stored record; only editable fields
      // belong in the subsequent autosave input.
      const { lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt } = response.draft;
      onApplied({ lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt }, response.draft.id); setMessage("Template filled the private draft.");
    } catch (cause) { if (!isCurrent()) return; setMessage(cause instanceof Error ? cause.message : "Template could not be applied."); }
  };
  return <section className="template-controls" aria-label="Update templates"><div><strong>Update templates</strong><p>Save this private draft and its affected components, or apply a saved template without publishing.</p></div><div className="template-form"><label className="form-label">Template name<input aria-label="Template name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Template name" /></label><label className="form-label">Next update offset (minutes)<input aria-label="Next update offset in minutes" type="number" min="1" max="10080" value={offset} onChange={(event) => setOffset(event.target.value)} /></label><Button type="button" variant="secondary" disabled={!name.trim()} onClick={save}>Save template</Button></div>{data?.templates.length ? <div className="template-form"><label className="form-label">Saved update template<select aria-label="Saved update template" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Choose a saved template</option>{data.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><Button type="button" variant="secondary" disabled={!selected} onClick={apply}>Apply template</Button></div> : null}{message ? <p role="status">{message}</p> : null}</section>;
}

type Report = { summary: string; timeline: string; cause: string; remediation: string; publishedAt: string | null };
export function ReportEditor({ incidentId }: { incidentId: string }) {
  const formatOperatorTime = useOperatorTime();
  const { data, refresh } = useAppData<{ report: Report | null }>(`/api/app/incidents/${incidentId}/report`);
  const [report, setReport] = useState<Report>({ summary: "", timeline: "", cause: "", remediation: "", publishedAt: null });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (data?.report) setReport(data.report); }, [data]);
  if (report.publishedAt) return <section className="context-section"><h2>Post-incident report</h2><p>Published {formatOperatorTime(report.publishedAt)}.</p></section>;
  const update = (field: keyof Omit<Report, "publishedAt">, value: string) => setReport((current) => ({ ...current, [field]: value }));
  const save = async () => {
    const { summary, timeline, cause, remediation } = report;
    try { await appApi(`/api/app/incidents/${incidentId}/report`, { method: "PUT", body: JSON.stringify({ summary, timeline, cause, remediation }) }); setMessage("Report saved."); refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be saved."); }
  };
  const publish = async () => { try { await appApi(`/api/app/incidents/${incidentId}/report/publish`, { method: "POST", body: JSON.stringify({ channels: ["email"] }) }); setMessage("Report published."); refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Report could not be published."); } };
  return <section className="context-section report-editor"><h2>Post-incident report</h2><p>Publish one factual report when this incident is complete.</p>{(["summary", "timeline", "cause", "remediation"] as const).map((field) => <label className="form-label" key={field}>{field[0].toUpperCase() + field.slice(1)}<textarea value={report[field]} maxLength={10_000} onChange={(event) => update(field, event.target.value)} /></label>)}{message ? <p role="status">{message}</p> : null}<div className="form-actions"><Button type="button" variant="secondary" onClick={save}>Save report</Button><Button type="button" onClick={publish}>Publish report</Button></div></section>;
}
