import { FormError } from "../../../app/client/ui/states";
import { fromPageDateTime, toPageDateTime } from "../../../app/client/ui/timezone";

export type Channel = "email" | "webhook" | "chat" | "sms" | "social";
/** When the update publishes: now, later (UPDATE-006, private until then) or at a past time (INCIDENT-009, notifies no one). */
export type PublishTiming = { mode: "now" | "schedule" | "backdate"; at: string | null };

const CHANNELS: Array<{ value: Channel; label: string; short: string; sends: string }> = [
  { value: "email", label: "Email", short: "email", sends: "emails subscribers" },
  { value: "sms", label: "SMS", short: "SMS", sends: "texts subscribers" },
  { value: "webhook", label: "Webhook", short: "webhooks", sends: "sends webhooks" },
  { value: "chat", label: "Slack and Teams", short: "Slack and Teams", sends: "posts to Slack and Teams" },
  { value: "social", label: "Social accounts", short: "social", sends: "posts to social accounts" },
];
const ordered = (channels: Channel[]) => CHANNELS.filter(channel => channels.includes(channel.value));
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A publication time as the page's zone reads it: the time alone today, with the day otherwise. */
export function publishTime(iso: string, timezone: string) {
  const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" }).format(value);
  const at = new Date(iso);
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(day(at) === day(new Date()) ? {} : { month: "short", day: "numeric" }) }).format(at);
}

/** What the options changed, said next to the publish button: when the update goes out and who hears about it.
 * Webhooks are named when left out, so an email-only update is never read as reaching every integration. */
export function publishHint(channels: Channel[], timing: PublishTiming, timezone: string) {
  if (timing.mode === "backdate") return "Historical: notifies no one";
  const when = timing.mode === "schedule" ? timing.at ? `schedules for ${publishTime(timing.at, timezone)}` : "choose when it publishes" : null;
  const who = channels.length ? [...ordered(channels).map(channel => channel.sends), ...(channels.includes("webhook") ? [] : ["no webhooks"])] : ["notifies no one"];
  return sentence([when, ...who].filter(Boolean).join(" · "));
}

/** The channels an update notifies, as the Notify entry shows them. */
export function channelSummary(channels: Channel[]) {
  return channels.length ? sentence(ordered(channels).map(channel => channel.short).join(", ")) : "No one";
}

/** NOTIFY-007: subscriber channels per update; the page, feed and widget always update. */
export function NotifyChannels({ channels, onChange }: { channels: Channel[]; onChange: (channels: Channel[]) => void }) {
  return <fieldset className="option-group">
    <legend className="sr-only">Notify</legend>
    <div className="channel-checks">{CHANNELS.map(channel => <label key={channel.value} className="checkbox-label"><input type="checkbox" checked={channels.includes(channel.value)} onChange={() => onChange(channels.includes(channel.value) ? channels.filter(item => item !== channel.value) : [...channels, channel.value])} />{channel.label}</label>)}</div>
  </fieldset>;
}

/** Now, Schedule or Backdate, and the time for the last two. Schedule… and Backdate… open it with their choice made. */
export function PublishTimingField({ timing, timezone, error, onChange, onError }: { timing: PublishTiming; timezone: string; error: string | null; onChange: (timing: PublishTiming) => void; onError: (message: string | null) => void }) {
  const setAt = (value: string) => { try { onChange({ ...timing, at: fromPageDateTime(value, timezone) }); onError(null); } catch (cause) { onChange({ ...timing, at: null }); onError((cause as Error).message); } };
  return <fieldset className="option-group publish-timing">
    <legend className="sr-only">Publish</legend>
    <div className="choice-row">{(["now", "schedule", "backdate"] as const).map(mode => <label key={mode} className="choice-pill"><input type="radio" name="publish-timing" checked={timing.mode === mode} onChange={() => { onChange({ mode, at: null }); onError(null); }} />{mode === "now" ? "Now" : mode === "schedule" ? "Schedule" : "Backdate"}</label>)}</div>
    {timing.mode === "schedule" ? <label className="form-label"><span className="sr-only">Scheduled publication</span><input aria-label="Scheduled publication date and time" type="datetime-local" value={toPageDateTime(timing.at, timezone)} onChange={(event) => setAt(event.target.value)} /><small>Stays private until then. Times in {timezone}.</small></label> : null}
    {timing.mode === "backdate" ? <label className="form-label"><span className="sr-only">Past update time</span><input aria-label="Historical publication date and time" type="datetime-local" value={toPageDateTime(timing.at, timezone)} onChange={(event) => setAt(event.target.value)} /><small>Notifies no one. Times in {timezone}.</small></label> : null}
    {error ? <FormError>{error}</FormError> : null}
  </fieldset>;
}
