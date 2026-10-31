import { useEffect, useRef, useState } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { leaveWhenSaved, useLeaveGuard } from "../../../app/client/ui/leave-guard";
import { FormError } from "../../../app/client/ui/states";
import { saveFailureReason, useReportPhase, type SavePhase } from "./settings-save-state";

type SmsPreferences = { countries: string[]; supportContact: string };
type SmsSettingsResponse = { settings: SmsPreferences; configured: boolean };
const countries = [
  ["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"],
  ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"], ["IN", "India"],
  ["JP", "Japan"], ["NZ", "New Zealand"], ["IE", "Ireland"], ["NL", "Netherlands"],
  ["ES", "Spain"], ["IT", "Italy"], ["BR", "Brazil"], ["MX", "Mexico"],
] as const;

/** Each change saves itself: a country at once, the support contact once typing pauses or the field is left. Its state
 * joins the pane's one save note through `onPhase`; a refused save keeps the change here with its reason and Retry. */
export function SmsSettings({ onPhase }: { onPhase: (phase: SavePhase) => void }) {
  const resource = useAppData<SmsSettingsResponse>("/api/app/sms/settings");
  const [draft, setDraft] = useState<SmsPreferences | null>(null);
  const [phase, setPhase] = useState<SavePhase>("saved");
  const [error, setError] = useState<string | null>(null);
  const queue = useRef({ value: null as SmsPreferences | null, revision: 0, completed: 0, stopped: -1, leaving: 0, released: false, answered: new Set<() => void>(), sending: false, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  useReportPhase(onPhase, phase);
  const settings = draft ?? resource.data?.settings;
  async function flush() {
    const q = queue.current;
    clearTimeout(q.timer);
    if (q.sending) return;
    q.sending = true;
    try {
      while (q.value && q.completed !== q.revision && q.stopped !== q.revision) {
        const revision = q.revision;
        setPhase("saving"); setError(null);
        try {
          await appApi<SmsSettingsResponse>("/api/app/sms/settings", { method: "PUT", body: JSON.stringify(q.value) });
          q.completed = revision;
          if (q.revision === revision) setPhase("saved");
        } catch (cause) {
          q.stopped = revision;
          if (q.revision === revision) { setPhase("error"); setError(`SMS settings could not be saved: ${saveFailureReason(cause)} Your change is kept here.`); }
        }
        for (const answer of [...q.answered]) answer();
      }
    } finally { q.sending = false; }
  }
  // Leaving the pane or Settings sends a change still waiting for its pause; a refused one is left behind only when the owner agrees.
  useEffect(() => () => { void flush(); }, []);
  useLeaveGuard(() => leaveWhenSaved(queue.current, () => void flush(), "SMS changes have not saved. Leave them behind?"), () => queue.current.completed !== queue.current.revision && !queue.current.released);
  function edit(value: SmsPreferences, immediate: boolean) {
    const q = queue.current;
    q.value = value; q.revision++; q.released = false;
    setDraft(value); setPhase(q.sending ? "saving" : "waiting"); setError(null);
    clearTimeout(q.timer); q.timer = setTimeout(() => void flush(), immediate ? 0 : 600);
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
        <label className="form-label">Support contact<input required maxLength={200} value={settings.supportContact} onChange={event => edit({ ...settings, supportContact: event.target.value }, false)} onBlur={() => void flush()} /></label>
      </div>
      {error && <p className="save-message" role="alert">{error} <Button type="button" variant="secondary" className="table-action" onClick={() => { queue.current.stopped = -1; void flush(); }}>Retry</Button></p>}
    </> : <p>Loading SMS settings…</p>}
    {resource.error && <FormError>{resource.error}</FormError>}
  </section>;
}
