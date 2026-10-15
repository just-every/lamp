import { IncidentComponentConfirmation } from "./incident-component-confirmation";
import { useState } from "react";
import { COMPONENT_STATES, type ComponentState } from "../../../shared/domain";
import type { ComponentsService } from "../../components";
import type { IncidentView, IncidentComponentChange, IncidentComponentChangePreview } from "../service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";

export function IncidentComponents({ incident, onChanged, captureVisit }: { incident: IncidentView; onChanged: () => void; captureVisit: () => () => boolean }) {
  const { data, error } = useAppData<{ components: Awaited<ReturnType<ComponentsService["list"]>> }>("/api/app/components");
  const [componentId, setComponentId] = useState("");
  const [state, setState] = useState<ComponentState>("Major outage");
  const [relationship, setRelationship] = useState<"Primary" | "Dependent">("Primary");
  const [confirmation, setConfirmation] = useState<{ change: IncidentComponentChange; preview: IncidentComponentChangePreview } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const available = data?.components.filter((component) => !component.internal && !incident.components.some((claim) => claim.componentId === component.id)) ?? [];
  async function applyChange(change: IncidentComponentChange) {
    const current = captureVisit();
    setSaving(true); setFailure(null);
    try {
      await appApi(`/api/app/incidents/${incident.id}/components${change.action === "detach" ? `/${change.componentId}` : ""}`, { method: change.action === "detach" ? "DELETE" : "POST", ...(change.action === "detach" ? {} : { body: JSON.stringify({ componentId: change.componentId, state: change.state, relationship: change.relationship }) }) });
      if (!current()) return;
      setConfirmation(null); setComponentId(""); onChanged();
    } catch (cause) { if (current()) setFailure(cause instanceof Error ? cause.message : "Affected components could not be changed."); }
    finally { if (current()) setSaving(false); }
  }
  async function mutate(detachId?: string) {
    const current = captureVisit();
    const change: IncidentComponentChange = detachId ? { action: "detach", componentId: detachId } : { action: "attach", componentId, state, relationship };
    setSaving(true); setFailure(null);
    try {
      const { preview } = await appApi<{ preview: IncidentComponentChangePreview }>(`/api/app/incidents/${incident.id}/components/preview`, { method: "POST", body: JSON.stringify(change) });
      if (!current()) return;
      if (preview.published) setConfirmation({ change, preview });
      else await applyChange(change);
    } catch (cause) { if (current()) setFailure(cause instanceof Error ? cause.message : "Affected components could not be previewed."); }
    finally { if (current()) setSaving(false); }
  }
  return <section className="context-section"><h2>Affected components</h2>
    {incident.components.length ? incident.components.map((component) => <div className="component-fact" key={component.id}><strong>{component.componentName}</strong><span>{component.relationship} · {component.state}</span>{incident.lifecycle !== "Resolved" && component.componentId ? <Button type="button" variant="secondary" style={{ minWidth: 0, maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" }} disabled={saving} onClick={() => void mutate(component.componentId!)}>Detach {component.componentName}</Button> : null}</div>) : <p>No components are attached. This incident cannot be published.</p>}
    {failure || error ? <FormError>{failure ?? error}</FormError> : null}
    {incident.lifecycle !== "Resolved" ? <form className="impact-form" onSubmit={(event) => { event.preventDefault(); void mutate(); }}>
      <label className="form-label">Component<select required value={componentId} disabled={saving} onChange={(event) => setComponentId(event.target.value)}><option value="">Choose a component</option>{available.map((component) => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label>
      <label className="form-label">Claim state<select value={state} disabled={saving} onChange={(event) => setState(event.target.value as ComponentState)}>{COMPONENT_STATES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="form-label">Relationship<select value={relationship} disabled={saving} onChange={(event) => setRelationship(event.target.value as "Primary" | "Dependent")}><option>Primary</option><option>Dependent</option></select></label>
      <Button type="submit" variant="secondary" disabled={saving || !componentId}>Attach component</Button>
    </form> : null}
    {confirmation && <IncidentComponentConfirmation {...confirmation} saving={saving} error={failure} onCancel={() => { setConfirmation(null); setFailure(null); }} onConfirm={() => void applyChange(confirmation.change)} />}
  </section>;
}
