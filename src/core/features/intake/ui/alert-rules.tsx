import { useEffect, useRef, useState, type FormEvent } from "react";

import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { useLeaveGuard } from "../../../app/client/ui/leave-guard";
import { FormError, LoadingState, useOperatorTime } from "../../../app/client/ui/states";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { IncidentTemplate } from "../../incidents/template-repository";
import { TemplateEditor } from "../../incidents/ui/template-editor";
import type { ComponentOption, Source } from "./tools";
import type { RuleView } from "../rule-schema";

type RuleMode = RuleView["mode"];
type Fields = { name: string; mode: RuleMode; state: ComponentState; templateId: string };
const defaults = (): Fields => ({ name: "", mode: "draft", state: "Degraded performance", templateId: "" });
const modeLabel = (mode: RuleMode) => mode === "claim-and-publish" ? "Claim and publish" : mode === "claim" ? "Claim" : "Draft";

export function AlertRulesSettings() {
  const sources = useAppData<{ sources: Source[] }>("/api/app/intake/sources");
  const components = useAppData<{ components: ComponentOption[] }>("/api/app/components");
  if ((sources.loading && !sources.data) || (components.loading && !components.data)) return <LoadingState>Loading alert rules…</LoadingState>;
  if (!sources.data || !components.data) return <ErrorState onRetry={() => { sources.refresh(); components.refresh(); }}>{sources.error ?? components.error ?? "Alert rule settings could not be loaded."}</ErrorState>;
  return <>
    <p><a className="text-link" href="/app/alerts">Manage alert sources</a></p>
    <AlertRules sources={sources.data.sources} components={components.data.components} />
  </>;
}

/** AUTO-001: one owner-approved rule for one component and source. A new pair remains draft-only until saved. */
export function AlertRules({ sources, components }: { sources: Source[]; components: ComponentOption[] }) {
  const rules = useAppData<{ rules: RuleView[] }>("/api/app/intake/rules");
  const templates = useAppData<{ templates: IncidentTemplate[] }>("/api/app/incident-templates");
  const [sourceId, setSourceId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [fields, setFields] = useState<Fields>(defaults);
  const [dirty, setDirty] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [editedTemplate, setEditedTemplate] = useState<IncidentTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visit = useRef(0);
  const mounted = useRef(true);
  const formatTime = useOperatorTime();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; visit.current++; }; }, []);
  const captureUpdate = () => { const version = visit.current; return () => mounted.current && visit.current === version; };
  const currentRule = rules.data?.rules.find(rule => rule.sourceId === sourceId && rule.componentId === componentId);
  const selectedTemplate = editedTemplate?.id === fields.templateId ? editedTemplate : templates.data?.templates.find(template => template.id === fields.templateId);
  const hasUnsaved = () => dirty || templateDirty;
  async function maySwitch() { return !hasUnsaved() || window.confirm("Leave without saving these rule or template changes?"); }
  useLeaveGuard(maySwitch, hasUnsaved);

  function selectPair(nextSourceId: string, nextComponentId: string) {
    if (hasUnsaved() && !window.confirm("Leave without saving these rule or template changes?")) return;
    const existing = rules.data?.rules.find(rule => rule.sourceId === nextSourceId && rule.componentId === nextComponentId);
    visit.current++;
    setSourceId(nextSourceId); setComponentId(nextComponentId);
    setFields(existing ? { name: existing.name, mode: existing.mode, state: existing.state, templateId: existing.templateId ?? "" } : defaults());
    setDirty(false); setTemplateDirty(false); setEditedTemplate(null); setError(null); setMessage(null);
  }
  function change<K extends keyof Fields>(key: K, value: Fields[K]) {
    if (templateDirty && (key === "templateId" || key === "mode") && !window.confirm("Leave without saving these template changes?")) return;
    setFields(current => ({ ...current, [key]: value })); setDirty(true); setMessage(null); setError(null);
    if (key === "templateId" || key === "mode") { visit.current++; setTemplateDirty(false); setEditedTemplate(null); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || templateDirty) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await appApi(`/api/app/intake/rules/${sourceId}/${componentId}`, { method: "PUT", body: JSON.stringify({ ...fields, templateId: fields.mode === "claim-and-publish" ? fields.templateId : null }) });
      setDirty(false); rules.refresh(); setMessage("Rule saved. Your approval is recorded in the audit log.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The rule could not be saved."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy || !window.confirm("Delete this rule? Future alerts will create private drafts.")) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await appApi(`/api/app/intake/rules/${sourceId}/${componentId}`, { method: "DELETE" });
      setFields(defaults()); setDirty(false); setTemplateDirty(false); rules.refresh(); setMessage("Rule deleted. This component and source use draft-only behavior.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The rule could not be deleted."); }
    finally { setBusy(false); }
  }
  const complete = sourceId && componentId && fields.name.trim() && (fields.mode !== "claim-and-publish" || fields.templateId);
  return <section className="data-card alert-rules" aria-labelledby="alert-rules-title">
    <div className="card-heading"><div><h2 id="alert-rules-title">Alert rules</h2><p className="card-support">Choose what alerts may do for each component and source. Without a saved rule, alerts create private drafts.</p></div></div>
    {rules.error ? <FormError>{rules.error} <Button type="button" variant="secondary" onClick={rules.refresh}>Retry rules</Button></FormError> : null}
    {rules.data?.rules.length ? <ul className="tool-list">{rules.data.rules.map(rule => <li className="tool-row" key={`${rule.sourceId}/${rule.componentId}`}>
      <span className="tool-row-name"><strong>{rule.name}</strong><small>{sources.find(source => source.id === rule.sourceId)?.name ?? "Removed source"} · {components.find(component => component.id === rule.componentId)?.name ?? "Removed component"}</small>{rule.degradationReason ? <span role="alert">Draft only: {rule.degradationReason}</span> : null}</span>
      <span className={`state-pill ${rule.degradationReason ? "state-degraded-performance" : "state-active"}`}>{rule.degradationReason ? "Needs attention" : modeLabel(rule.mode)}</span>
      <span className="tool-row-actions"><Button type="button" variant="secondary" className="table-action" aria-label={`Edit rule ${rule.name}`} disabled={busy} onClick={() => selectPair(rule.sourceId, rule.componentId)}>Edit</Button></span>
    </li>)}</ul> : null}
    <div className="tool-fields">
      <label className="form-label">Source<select aria-label="Rule source" disabled={busy || !rules.data} value={sourceId} onChange={event => selectPair(event.target.value, componentId)}><option value="">Choose a source</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
      <label className="form-label">Component<select aria-label="Rule component" disabled={busy || !rules.data} value={componentId} onChange={event => selectPair(sourceId, event.target.value)}><option value="">Choose a component</option>{components.map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
    </div>
    {sourceId && componentId ? <form className="tool-fields" onSubmit={save} aria-label="Alert rule settings">
      <p>{currentRule ? `Approved by ${currentRule.approvedByName}, ${formatTime(currentRule.updatedAt)}.` : "Draft is the default. Saving a rule records your approval."}</p>
      {currentRule?.degradationReason ? <p role="alert">Draft only: {currentRule.degradationReason}</p> : null}
      <label className="form-label">Rule name<input aria-label="Rule name" required maxLength={120} value={fields.name} disabled={busy} onChange={event => change("name", event.target.value)} placeholder="API availability" /></label>
      <label className="form-label">When this source fires<select aria-label="Alert action" value={fields.mode} disabled={busy} onChange={event => change("mode", event.target.value as RuleMode)}><option value="draft">Draft</option><option value="claim">Claim</option><option value="claim-and-publish">Claim and publish</option></select><small>{fields.mode === "draft" ? "Creates a private draft. Nothing public changes." : fields.mode === "claim" ? "Claims this component's state while firing, then releases on recovery. No update or notification is sent." : "Claims this component and publishes only the saved template wording. Recovery publishes its saved Resolved update."}</small></label>
      {fields.mode !== "draft" ? <label className="form-label">Claimed state<select aria-label="Claimed state" disabled={busy} value={fields.state} onChange={event => change("state", event.target.value as ComponentState)}>{COMPONENT_STATES.map(state => <option key={state}>{state}</option>)}</select></label> : null}
      {fields.mode === "claim-and-publish" ? <>
        <label className="form-label">Saved template<select aria-label="Rule template" required disabled={busy} value={fields.templateId} onChange={event => change("templateId", event.target.value)}><option value="">Choose a saved template</option>{templates.data?.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select><small>Save a template from an incident composer first. It needs complete update wording, a Resolved update and notification channels.</small></label>
        {templates.error ? <FormError>{templates.error} <Button type="button" variant="secondary" onClick={templates.refresh}>Retry templates</Button></FormError> : null}
        {selectedTemplate ? <details className="tool-more"><summary>Edit saved template</summary><TemplateEditor key={selectedTemplate.id} template={selectedTemplate} onDirty={setTemplateDirty} captureUpdate={captureUpdate} onSaved={template => { setEditedTemplate(template); templates.refresh(); rules.refresh(); }} /></details> : null}
        {templateDirty ? <p role="status">Save the template changes before saving the rule.</p> : null}
      </> : null}
      <div className="form-actions"><Button type="submit" disabled={busy || !complete || templateDirty}>{busy ? "Saving…" : "Save rule"}</Button>{currentRule ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void remove()}>Delete rule</Button> : null}</div>
    </form> : <p>Choose a source and component to review or save their rule.</p>}
    {error ? <FormError>{error}</FormError> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
