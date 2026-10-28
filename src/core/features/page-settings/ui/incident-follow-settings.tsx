import { useState } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { FormError } from "../../../app/client/ui/states";
import type { IncidentFollowSettings as FollowSettings } from "../../subscribers/incident-follow-settings.repository";

export function IncidentFollowSettings() {
  const resource = useAppData<FollowSettings>("/api/app/incident-follow-settings");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);
  async function change(includeReport: boolean) {
    setSaving(true); setError(null); setSaved(false); setSelected(includeReport);
    try {
      const result = await appApi<FollowSettings>("/api/app/incident-follow-settings", { method: "PATCH", body: JSON.stringify({ includeReport }) });
      setSelected(result.includeReport); resource.refresh(); setSaved(true);
    } catch (cause) {
      setSelected(null); setError(cause instanceof Error ? cause.message : "Incident subscription settings could not be saved.");
    } finally { setSaving(false); }
  }
  return <section className="data-card" aria-labelledby="incident-follow-settings-title">
    <h2 id="incident-follow-settings-title">Incident subscriptions</h2>
    {resource.data ? <>
      <label className="checkbox-label"><input type="checkbox" checked={selected ?? resource.data.includeReport} disabled={saving} onChange={event => void change(event.target.checked)} />Include the post-incident report</label>
      <p>New incident followers receive the report when published, for up to 30 days after resolution. Turn this off to end new subscriptions after the resolution is delivered.</p>
      {saving && <p role="status">Saving incident subscription settings…</p>}
      {saved && !saving && <p role="status">Incident subscription settings saved.</p>}
    </> : <p>Loading incident subscription settings…</p>}
    {(error || resource.error) && <FormError>{error || resource.error}</FormError>}
  </section>;
}
