import { useState } from "react";
import { INCIDENT_CLAIM_STATES, type IncidentClaimState } from "../../../shared/incident-component-changes";
import type { IncidentDraftInput } from "../../../shared/schemas";
import type { IncidentView } from "../service";
import type { ComponentsService } from "../../components";
import { useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";

export function DraftComponentStates({ incident, draft, onChange }: {
  incident: IncidentView;
  draft: IncidentDraftInput;
  onChange: (changes: NonNullable<IncidentDraftInput["componentChanges"]>) => void;
}) {
  const { data, error } = useAppData<{ components: Awaited<ReturnType<ComponentsService["list"]>> }>("/api/app/components");
  const [componentId, setComponentId] = useState("");
  const [relationship, setRelationship] = useState<"Primary" | "Dependent">("Primary");
  const [state, setState] = useState<IncidentClaimState>("Major outage");
  const choices = draft.componentChanges ?? [];
  const resolved = draft.lifecycle === "Resolved";
  const available = data?.components.filter(component => !component.internal && !incident.components.some(row => row.componentId === component.id) && !choices.some(choice => choice.componentId === component.id)) ?? [];
  const rows = [
    ...incident.components.flatMap(row => row.componentId ? [{ componentId: row.componentId, name: row.componentName, current: row.publishedAt && incident.lifecycle !== "Resolved" ? row.state : "Operational", relationship: row.relationship }] : []),
    ...choices.filter(choice => !incident.components.some(row => row.componentId === choice.componentId)).map(choice => ({ componentId: choice.componentId, name: data?.components.find(component => component.id === choice.componentId)?.name ?? incident.draft?.componentChanges.find(component => component.componentId === choice.componentId)?.componentName ?? choice.componentId, current: "Operational", relationship: choice.relationship ?? "Primary" as const })),
  ];
  const choose = (id: string, next: IncidentClaimState, relationship: "Primary" | "Dependent") => onChange([
    ...choices.filter(choice => choice.componentId !== id), { componentId: id, state: next, relationship },
  ]);

  return <fieldset className="impact-field">
    <legend>Component states with this update</legend>
    <p>Changes stay private until you publish. Operational clears this incident’s status; the component stays attached.</p>
    {rows.map(row => <div key={row.componentId} className="component-fact">
      <strong>{row.name}</strong><span>Status: {row.current}</span>
      <label className="form-label">{row.name} state with this update<select aria-label={`${row.name} state with this update`} disabled={resolved} value={resolved ? "Operational" : choices.find(choice => choice.componentId === row.componentId)?.state ?? incident.components.find(component => component.componentId === row.componentId)?.state ?? "Operational"} onChange={event => choose(row.componentId, event.target.value as IncidentClaimState, row.relationship)}>
        {INCIDENT_CLAIM_STATES.map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label className="form-label">{row.name} relationship with this update<select aria-label={`${row.name} relationship with this update`} disabled={resolved} value={choices.find(choice => choice.componentId === row.componentId)?.relationship ?? row.relationship} onChange={event => choose(row.componentId, (choices.find(choice => choice.componentId === row.componentId)?.state ?? incident.components.find(component => component.componentId === row.componentId)?.state ?? "Operational") as IncidentClaimState, event.target.value as "Primary" | "Dependent")}><option>Primary</option><option>Dependent</option></select></label>
      {choices.some(choice => choice.componentId === row.componentId) && <Button type="button" variant="secondary" onClick={() => onChange(choices.filter(choice => choice.componentId !== row.componentId))}>{incident.components.some(component => component.componentId === row.componentId) ? "Keep current claim" : "Remove from draft"}</Button>}
      {!resolved && <Button type="button" variant="secondary" onClick={() => choose(row.componentId, "Operational", row.relationship)}>Release {row.name} with this update</Button>}
    </div>)}
    {resolved ? <p>Resolving clears component statuses.</p> : <div className="settings-grid">
      <label className="form-label">Attach with this update<select value={componentId} onChange={event => setComponentId(event.target.value)}><option value="">Choose a component</option>{available.map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
      <label className="form-label">New component state<select value={state} onChange={event => setState(event.target.value as IncidentClaimState)}>{INCIDENT_CLAIM_STATES.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="form-label">Relationship<select value={relationship} onChange={event => setRelationship(event.target.value as "Primary" | "Dependent")}><option>Primary</option><option>Dependent</option></select></label>
      <Button type="button" variant="secondary" disabled={!componentId} onClick={() => { choose(componentId, state, relationship); setComponentId(""); }}>Attach with this update</Button>
    </div>}
    {error && <FormError>{error}</FormError>}
  </fieldset>;
}
