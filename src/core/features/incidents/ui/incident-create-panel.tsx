import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import type { ComponentState } from "../../../shared/domain";
import { COMPONENT_STATES } from "../../../shared/domain";
import type { ComponentsService } from "../../components";
import type { IncidentsService } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { LoadingState, FormError } from "../../../app/client/ui/states";

import { usePageTimezone, fromPageDateTime } from "../../../app/client/ui/timezone";

type ComponentsResponse = {
  components: Awaited<ReturnType<ComponentsService["list"]>>;
};

type Incident = Awaited<ReturnType<IncidentsService["create"]>>;
type ClaimDraft = { componentId: string; state: ComponentState; relationship: "Primary" | "Dependent" };

function newClaim(): ClaimDraft {
  return { componentId: "", state: "Major outage", relationship: "Primary" };
}

export function IncidentCreatePanel({ onCreated, onCancel }: { onCreated: (incident: Incident) => void; onCancel: () => void }) {
  const timezone = usePageTimezone();
  const { data, loading, error } = useAppData<ComponentsResponse>("/api/app/components");
  const [title, setTitle] = useState("");
  const [openedAt, setOpenedAt] = useState("");
  const [claims, setClaims] = useState<ClaimDraft[]>([newClaim()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const components = data?.components.filter((component) => !component.internal) ?? [];

  const updateClaim = (index: number, change: Partial<ClaimDraft>) => setClaims((current) => current.map((claim, currentIndex) => currentIndex === index ? { ...claim, ...change } : claim));
  const removeClaim = (index: number) => setClaims((current) => current.length === 1 ? current : current.filter((_, currentIndex) => currentIndex !== index));

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) { setFormError("Give the incident a short customer-facing title."); return; }
    if (!claims.length || claims.some((claim) => !claim.componentId)) { setFormError("Select at least one affected component."); return; }
    if (new Set(claims.map((claim) => claim.componentId)).size !== claims.length) { setFormError("Attach each component only once."); return; }
    setSaving(true); setFormError(null);
    try {
      const response = await appApi<{ incident: Incident }>("/api/app/incidents", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), openedAt: fromPageDateTime(openedAt, timezone) ?? undefined, components: claims }),
      });
      onCreated(response.incident);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "The incident could not be created.");
      setSaving(false);
    }
  }

  return <section className="data-card incident-create-panel" aria-labelledby="create-incident-title">
    <div className="incident-create-heading"><div><p className="card-kicker">New incident</p><h2 id="create-incident-title">Record the situation before communicating it</h2><p>Create a private incident draft with the affected components. The customer update remains editable in the next step.</p></div><Button type="button" variant="secondary" onClick={onCancel}>Close</Button></div>
    {loading ? <LoadingState /> : error ? <FormError>{error}</FormError> : components.length === 0 ? <div className="incident-create-empty"><p>Add a public component before recording an incident.</p><Link className="button button-primary" to="/app/components">Add component</Link></div> : <form className="incident-create-form" onSubmit={create}>
      <label className="form-label">Incident title<input aria-label="Incident title" required maxLength={250} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Describe the customer-facing condition" /></label>
      <label className="form-label"><span>Opened at <small>Optional historical record</small></span><input aria-label="Opened at" type="datetime-local" value={openedAt} onChange={(event) => setOpenedAt(event.target.value)} /><small>Times in {timezone}. Use the actual start time when recording a past incident. A later retroactive publication never sends notifications.</small></label>
      <fieldset className="incident-component-claims"><legend>Affected components</legend><p>Component statuses are kept private until the first customer update is published.</p>{claims.map((claim, index) => <div className="incident-claim-row" key={index}><label className="form-label"><span className="sr-only">Component {index + 1}</span><select aria-label={`Affected component ${index + 1}`} value={claim.componentId} onChange={(event) => updateClaim(index, { componentId: event.target.value })}><option value="">Choose component</option>{components.map((component) => <option key={component.id} value={component.id} disabled={claims.some((other, otherIndex) => otherIndex !== index && other.componentId === component.id)}>{component.name}</option>)}</select></label><label className="form-label"><span className="sr-only">Component status {index + 1}</span><select aria-label={`Component status ${index + 1}`} value={claim.state} onChange={(event) => updateClaim(index, { state: event.target.value as ComponentState })}>{COMPONENT_STATES.map((state) => <option key={state}>{state}</option>)}</select></label><label className="form-label"><span className="sr-only">Component relationship {index + 1}</span><select aria-label={`Component relationship ${index + 1}`} value={claim.relationship} onChange={(event) => updateClaim(index, { relationship: event.target.value as ClaimDraft["relationship"] })}><option>Primary</option><option>Dependent</option></select></label><Button className="claim-remove-button" type="button" variant="secondary" onClick={() => removeClaim(index)} disabled={claims.length === 1}>Remove</Button></div>)}</fieldset>
      {formError ? <FormError>{formError}</FormError> : null}
      <div className="incident-create-actions"><Button type="button" variant="secondary" onClick={() => setClaims((current) => [...current, newClaim()])}>Add affected component</Button><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create incident draft"}</Button></div>
    </form>}
  </section>;
}
