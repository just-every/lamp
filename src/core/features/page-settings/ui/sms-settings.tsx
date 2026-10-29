import { useEffect, useRef, useState } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { CardSaveNote } from "./settings-save-state";

type SmsPreferences = { countries: string[]; supportContact: string };
type SmsSettingsResponse = { settings: SmsPreferences; configured: boolean };
const countries = [
  ["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"],
  ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"], ["IN", "India"],
  ["JP", "Japan"], ["NZ", "New Zealand"], ["IE", "Ireland"], ["NL", "Netherlands"],
  ["ES", "Spain"], ["IT", "Italy"], ["BR", "Brazil"], ["MX", "Mexico"],
] as const;

// The server refuses an empty list or contact; the card says so without sending it.
const problem = (value: SmsPreferences) => !value.countries.length ? "Choose at least one country to save SMS settings."
  : !value.supportContact.trim() ? "Enter a support contact to save SMS settings." : null;

/** Every change saves itself: a country at once, the support contact once typing pauses or the field is left. */
export function SmsSettings() {
  const resource = useAppData<SmsSettingsResponse>("/api/app/sms/settings");
  const [draft, setDraft] = useState<SmsPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const queue = useRef({ value: null as SmsPreferences | null, revision: 0, completed: 0, stopped: -1, sending: false, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const settings = draft ?? resource.data?.settings;
  async function flush() {
    const q = queue.current;
    clearTimeout(q.timer);
    if (q.sending) return;
    q.sending = true;
    try {
      while (q.value && q.completed !== q.revision && q.stopped !== q.revision) {
        const revision = q.revision, value = q.value;
        const refused = problem(value);
        if (refused) { q.stopped = revision; setSaving(false); setError(refused); setFailed(false); break; }
        setSaving(true); setError(null); setFailed(false);
        try {
          const response = await appApi<SmsSettingsResponse>("/api/app/sms/settings", { method: "PUT", body: JSON.stringify(value) });
          q.completed = revision;
          if (q.revision === revision) { setDraft(response.settings); setSaved(true); resource.refresh(); }
        } catch (cause) {
          q.stopped = revision;
          setError(`SMS settings could not be saved: ${cause instanceof Error ? cause.message : "The server could not be reached."} Your change is kept here.`);
          setFailed(true);
        }
        setSaving(q.revision !== revision && q.stopped !== q.revision);
      }
    } finally { q.sending = false; }
  }
  // Leaving Settings sends a change still waiting for its pause.
  useEffect(() => () => { void flush(); }, []);
  function edit(value: SmsPreferences, immediate: boolean) {
    const q = queue.current;
    q.value = value; q.revision++;
    setDraft(value); setSaved(false); setError(null);
    clearTimeout(q.timer);
    if (immediate) void flush(); else q.timer = setTimeout(() => void flush(), 600);
  }
  return <section className="data-card" aria-label="SMS delivery">
    <h2>SMS delivery</h2>
    {settings ? <>
      <p>{resource.data?.configured ? "SMS sending is configured." : "SMS sending is off. Connect a Twilio provider in your hosting settings to enable it."}</p>
      <div className="incident-note-form">
        <fieldset className="option-group">
          <legend>Accepted countries</legend>
          <div className="channel-checks">{countries.map(([code, name]) => <label className="checkbox-label" key={code}><input type="checkbox" checked={settings.countries.includes(code)} onChange={event => edit({ ...settings, countries: event.target.checked ? [...settings.countries, code] : settings.countries.filter(country => country !== code) }, true)} />{name}</label>)}</div>
        </fieldset>
        <label className="form-label">Support contact<input maxLength={200} value={settings.supportContact} onChange={event => edit({ ...settings, supportContact: event.target.value }, false)} onBlur={() => void flush()} /></label>
      </div>
      <CardSaveNote saving={saving} saved={saved} />
    </> : <p>Loading SMS settings…</p>}
    {(error || resource.error) && <FormError>{error || resource.error}{error && failed && <> <Button type="button" variant="secondary" className="table-action" onClick={() => { queue.current.stopped = -1; void flush(); }}>Retry</Button></>}</FormError>}
  </section>;
}
