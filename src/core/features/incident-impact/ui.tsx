import { useState } from "react";
import { appApi, useAppData } from "../../app/client/ui/api";
import { Button } from "../../app/client/ui/button";
import { FormError } from "../../app/client/ui/states";
import { INCIDENT_IMPACTS, impactLabel, type IncidentImpact } from "../../shared/incident-impact";
import type { IncidentImpactView } from "./repository";

/** Own reads and refreshes leave the incident's unsaved composer untouched. */
export function IncidentImpactCard({ incidentId }: { incidentId: string }) {
  const { data, loading, error, refresh } = useAppData<{ impact: IncidentImpactView }>(`/api/app/incidents/${incidentId}/impact`);
  const [choice, setChoice] = useState<IncidentImpact | "derived" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const impact = data?.impact;
  const selected = choice ?? impact?.impactOverride ?? "derived";
  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      await appApi(`/api/app/incidents/${incidentId}/impact`, { method: "PUT", body: JSON.stringify({ impactOverride: selected === "derived" ? null : selected }) });
      setChoice(null); refresh();
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Impact could not be saved."); }
    finally { setSaving(false); }
  };
  return <section className="panel" aria-labelledby="incident-impact-title">
    <h2 id="incident-impact-title">Incident impact</h2>
    {impact ? <>
      <dl className="context-facts"><div><dt>Set impact</dt><dd>{impact.impactOverride === null ? "From components" : impactLabel(impact.impactOverride)}</dd></div><div><dt>Components</dt><dd>{impactLabel(impact.derivedImpact)}</dd></div><div><dt>Public impact</dt><dd>{impactLabel(impact.effectiveImpact)}</dd></div></dl>
      <p>Impact describes this incident. Component status and uptime stay the same.</p>
      <label htmlFor={`impact-${incidentId}`}>Set public impact</label>{" "}
      <select id={`impact-${incidentId}`} value={selected} disabled={saving} onChange={event => setChoice(event.target.value as IncidentImpact | "derived")}><option value="derived">From components</option>{INCIDENT_IMPACTS.map(value => <option key={value} value={value}>{impactLabel(value)}</option>)}</select>{" "}
      <Button type="button" disabled={saving || selected === (impact.impactOverride ?? "derived")} onClick={() => void save()}>{saving ? "Saving…" : "Save impact"}</Button>
      <details><summary>Impact history ({impact.history.length})</summary>{impact.history.length ? <ol>{impact.history.map(change => <li key={change.id}>{change.operatorName}: {change.previousOverride === null ? "Components" : impactLabel(change.previousOverride)} → {change.impactOverride === null ? "Components" : impactLabel(change.impactOverride)} · <time dateTime={change.createdAt}>{new Date(change.createdAt).toLocaleString()}</time></li>)}</ol> : <p>No operator changes.</p>}</details>
    </> : loading ? <p role="status">Loading incident impact…</p> : null}
    {error || saveError ? <FormError>{saveError ?? error}</FormError> : null}
  </section>;
}
