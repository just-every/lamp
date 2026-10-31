import { useState } from "react";
import { appApi, useAppData } from "../../app/client/ui/api";
import { FormError } from "../../app/client/ui/states";
import { INCIDENT_IMPACTS, impactLabel, type IncidentImpact } from "../../shared/incident-impact";
import type { IncidentImpactView } from "./repository";

/** Own reads and refreshes leave the incident's unsaved composer untouched. */
export function useIncidentImpact(incidentId: string) {
  const { data, loading, error, refresh } = useAppData<{ impact: IncidentImpactView }>(`/api/app/incidents/${incidentId}/impact`);
  return { impact: data?.impact ?? null, loading, error, refresh };
}

/** The impact row's one line: the impact customers see, and whether an operator set it. */
export function impactSummary(impact: IncidentImpactView | null, error: string | null) {
  if (!impact) return error ? "Could not be read" : "Reading the impact…";
  return impact.impactOverride === null ? `${impactLabel(impact.effectiveImpact)} · from components` : `${impactLabel(impact.impactOverride)} · set by an operator`;
}

/** The set impact: one select that saves as it changes, with its history inside. */
export function IncidentImpactChoice({ incidentId, impact, error, onSaved }: { incidentId: string; impact: IncidentImpactView | null; error: string | null; onSaved: () => void }) {
  const [choice, setChoice] = useState<IncidentImpact | "derived" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!impact) return error ? <FormError>{error}</FormError> : <p role="status">Loading incident impact…</p>;
  const selected = choice ?? impact.impactOverride ?? "derived";
  const save = async (next: IncidentImpact | "derived") => {
    setChoice(next); setSaving(true); setSaveError(null); setSaved(false);
    try {
      await appApi(`/api/app/incidents/${incidentId}/impact`, { method: "PUT", body: JSON.stringify({ impactOverride: next === "derived" ? null : next }) });
      setSaved(true); onSaved();
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Impact could not be saved."); }
    finally { setChoice(null); setSaving(false); }
  };
  return <div className="incident-impact">
    <label className="field-label" htmlFor={`impact-${incidentId}`}>Set public impact</label>
    <select id={`impact-${incidentId}`} value={selected} disabled={saving} onChange={event => void save(event.target.value as IncidentImpact | "derived")}><option value="derived">From components ({impactLabel(impact.derivedImpact)})</option>{INCIDENT_IMPACTS.map(value => <option key={value} value={value}>{impactLabel(value)}</option>)}</select>
    <p>Impact describes this incident. Component status and uptime stay the same.</p>
    <details><summary>Impact history ({impact.history.length})</summary>{impact.history.length ? <ol>{impact.history.map(change => <li key={change.id}>{change.operatorName}: {change.previousOverride === null ? "Components" : impactLabel(change.previousOverride)} → {change.impactOverride === null ? "Components" : impactLabel(change.impactOverride)} · <time dateTime={change.createdAt}>{new Date(change.createdAt).toLocaleString()}</time></li>)}</ol> : <p>No operator changes.</p>}</details>
    {saving ? <p role="status">Saving impact…</p> : saved ? <p role="status">Impact saved.</p> : null}
    {saveError || error ? <FormError>{saveError ?? error}</FormError> : null}
  </div>;
}
