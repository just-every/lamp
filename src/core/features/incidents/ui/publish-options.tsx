import { FormError } from "../../../app/client/ui/states";
import { fromPageDateTime, toPageDateTime } from "../../../app/client/ui/timezone";

export type Channel = "email" | "webhook" | "chat";
/** When the update publishes: now, later (UPDATE-006, private until then) or at a past time (INCIDENT-009, notifies no one). */
export type PublishTiming = { mode: "now" | "schedule" | "backdate"; at: string | null };

/** Who hears about the update, said next to the publish button. */
export function publishHint(channels: Channel[], timing: PublishTiming) {
  if (timing.mode === "backdate" || !channels.length) return "Notifies no one";
  return channels.includes("email") ? "Emails subscribers" : "Notifies subscribers";
}

const CHANNELS: Array<{ value: Channel; label: string }> = [{ value: "email", label: "Email" }, { value: "webhook", label: "Webhook" }, { value: "chat", label: "Slack and Teams" }];

/** Who is notified and when the update publishes, together under More options. */
export function PublicationControls({ channels, onChannels, timing, timezone, error, onTiming, onError }: { channels: Channel[]; onChannels: (channels: Channel[]) => void; timing: PublishTiming; timezone: string; error: string | null; onTiming: (timing: PublishTiming) => void; onError: (message: string | null) => void }) {
  return <section className="publication-controls" aria-label="Publication controls">
    <NotifyChannels channels={channels} onChange={onChannels} />
    <PublishTimingField timing={timing} timezone={timezone} error={error} onChange={onTiming} onError={onError} />
  </section>;
}

/** NOTIFY-007: subscriber channels per update; the page, feed and widget always update. */
function NotifyChannels({ channels, onChange }: { channels: Channel[]; onChange: (channels: Channel[]) => void }) {
  return <fieldset className="option-group">
    <legend>Notify</legend>
    <div className="channel-checks">{CHANNELS.map(channel => <label key={channel.value} className="checkbox-label"><input type="checkbox" checked={channels.includes(channel.value)} onChange={() => onChange(channels.includes(channel.value) ? channels.filter(item => item !== channel.value) : [...channels, channel.value])} />{channel.label}</label>)}</div>
  </fieldset>;
}

function PublishTimingField({ timing, timezone, error, onChange, onError }: { timing: PublishTiming; timezone: string; error: string | null; onChange: (timing: PublishTiming) => void; onError: (message: string | null) => void }) {
  const setAt = (value: string) => { try { onChange({ ...timing, at: fromPageDateTime(value, timezone) }); onError(null); } catch (cause) { onChange({ ...timing, at: null }); onError((cause as Error).message); } };
  return <fieldset className="option-group publish-timing">
    <legend>Publish</legend>
    <div className="choice-row">{(["now", "schedule", "backdate"] as const).map(mode => <label key={mode} className="choice-pill"><input type="radio" name="publish-timing" checked={timing.mode === mode} onChange={() => { onChange({ mode, at: null }); onError(null); }} />{mode === "now" ? "Now" : mode === "schedule" ? "Schedule" : "Backdate"}</label>)}</div>
    {timing.mode === "schedule" ? <label className="form-label"><span className="sr-only">Scheduled publication</span><input aria-label="Scheduled publication date and time" type="datetime-local" value={toPageDateTime(timing.at, timezone)} onChange={(event) => setAt(event.target.value)} /><small>Stays private until then. Times in {timezone}.</small></label> : null}
    {timing.mode === "backdate" ? <label className="form-label"><span className="sr-only">Past update time</span><input aria-label="Historical publication date and time" type="datetime-local" value={toPageDateTime(timing.at, timezone)} onChange={(event) => setAt(event.target.value)} /><small>Notifies no one. Times in {timezone}.</small></label> : null}
    {error ? <FormError>{error}</FormError> : null}
  </fieldset>;
}
