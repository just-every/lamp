import { useState } from "react";
import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { ComponentsService } from "../../components";
import type { IncidentView } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";

export function IncidentComponents({ incident, onChanged, captureVisit }: { incident: IncidentView; onChanged: () => void; captureVisit: () => () => boolean }) {
  const { data, error } = useAppData<{ components: Awaited<ReturnType<ComponentsService["list"]>> }>("/api/app/components");
  const [componentId, setComponentId] = useState("");
  const [state, setState] = useState<ComponentState>("Major outage");
  const [relationship, setRelationship] = useState<"Primary" | "Dependent">("Primary");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const available = data?.components.filter((component) => !incident.components.some((claim) => claim.componentId === component.id)) ?? [];
  async function mutate(detachId?: string) {
    const current = captureVisit();
    setSaving(true); setFailure(null);
    try {
      await appApi(`/api/app/incidents/${incident.id}/components${detachId ? `/${detachId}` : ""}`, { method: detachId ? "DELETE" : "POST", ...(detachId ? {} : { body: JSON.stringify({ componentId, state, relationship }) }) });
      if (!current()) return;
      setComponentId(""); onChanged();
    } catch (cause) { if (current()) setFailure(cause instanceof Error ? cause.message : "Affected components could not be changed."); }
    finally { if (current()) setSaving(false); }
  }
  return <section className="context-section"><h2>Affected components</h2>
    {incident.components.length ? incident.components.map((component) => <div className="component-fact" key={component.id}><strong>{component.componentName}</strong><span>{component.relationship} · {component.state}</span>{incident.lifecycle !== "Resolved" && component.componentId ? <Button type="button" variant="secondary" disabled={saving} onClick={() => void mutate(component.componentId!)}>Detach {component.componentName}</Button> : null}</div>) : <p>No components are attached. This incident cannot be published.</p>}
    {failure || error ? <FormError>{failure ?? error}</FormError> : null}
    {incident.lifecycle !== "Resolved" ? <form className="impact-form" onSubmit={(event) => { event.preventDefault(); void mutate(); }}>
      <label className="form-label">Component<select required value={componentId} disabled={saving} onChange={(event) => setComponentId(event.target.value)}><option value="">Choose a component</option>{available.map((component) => <option key={component.id} value={component.id}>{component.name}{component.internal ? " (internal)" : ""}</option>)}</select></label>
      <label className="form-label">Claim state<select value={state} disabled={saving} onChange={(event) => setState(event.target.value as ComponentState)}>{COMPONENT_STATES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="form-label">Relationship<select value={relationship} disabled={saving} onChange={(event) => setRelationship(event.target.value as "Primary" | "Dependent")}><option>Primary</option><option>Dependent</option></select></label>
      <Button type="submit" variant="secondary" disabled={saving || !componentId}>Attach component</Button>
    </form> : null}
  </section>;
}
