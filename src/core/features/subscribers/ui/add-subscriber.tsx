import { useState, type FormEvent } from "react";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { SubscriberSelection } from "./subscriber-selection";
import { WebhookFormatChoice, type WebhookFormat } from "./webhook-format";
import { defaultPreferences, eventKinds, type SubscriberEventKind } from "../preferences";

export function AddSubscriber({ onChanged }: { onChanged: () => void }) {
  const [channel, setChannel] = useState<"email" | "webhook" | "sms">("email");
  const [email, setEmail] = useState("");
  const [destination, setDestination] = useState("");
  const [phone, setPhone] = useState("");
  const [webhookFormat, setWebhookFormat] = useState<WebhookFormat>("lamp");
  const [selectedEvents, setSelectedEvents] = useState<SubscriberEventKind[]>(defaultPreferences("email").eventKinds);
  const [minimumImpact, setMinimumImpact] = useState<"Partially unavailable" | null>(null);
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(null); setResult(null);
    try {
      const preferences = { eventKinds: selectedEvents, minimumImpact };
      const input = channel === "email" ? { channel, email, componentIds, ...preferences } : channel === "sms" ? { channel, phone, componentIds, ...preferences } : { channel, destination, contactEmail: email, componentIds, webhookFormat, ...preferences };
      const response = await appApi<{ created: boolean; confirmationSent: boolean }>("/api/app/subscribers", { method: "POST", body: JSON.stringify(input) });
      setResult(response.created ? response.confirmationSent ? "Subscriber added as pending. One confirmation invitation was sent." : "Subscriber added as pending. A recent confirmation to this contact prevented another invitation." : response.confirmationSent ? "One confirmation invitation was sent to the pending subscriber." : "This subscriber already exists. Their subscription was preserved and no invitation was sent.");
      setEmail(""); setPhone(""); setDestination(""); setComponentIds([]); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The subscriber could not be added."); }
    finally { setPending(false); }
  }
  return <section className="data-card" aria-label="Add subscriber">
    <h2>Add subscriber</h2><p>Your add sends one confirmation invitation. The subscription stays pending until the recipient confirms.</p>
    <form className="incident-note-form" onSubmit={submit}>
      <label className="form-label">Channel<select aria-label="Channel" value={channel} disabled={pending} onChange={event => { const next = event.target.value as "email" | "webhook" | "sms"; setChannel(next); setSelectedEvents(defaultPreferences(next).eventKinds); setMinimumImpact(null); setResult(null); }}><option value="email">Email</option><option value="sms">SMS</option><option value="webhook">Webhook</option></select></label>
      {channel === "webhook" ? <label className="form-label">Endpoint URL<input type="url" required disabled={pending} value={destination} onChange={event => setDestination(event.target.value)} /></label> : null}
      {channel === "sms" ? <label className="form-label">Mobile number<input type="tel" autoComplete="tel" placeholder="+12025550100" pattern="[+][1-9][0-9]{7,14}" required disabled={pending} value={phone} onChange={event => setPhone(event.target.value)} /></label> : <label className="form-label">{channel === "email" ? "Email address" : "Contact email"}<input type="email" required disabled={pending} value={email} onChange={event => setEmail(event.target.value)} /></label>}
      {channel === "webhook" ? <WebhookFormatChoice value={webhookFormat} onChange={setWebhookFormat} disabled={pending} /> : null}
      <SubscriberSelection selected={componentIds} onChange={setComponentIds} disabled={pending} />
      <fieldset className="maintenance-components" disabled={pending}>
        <legend>Updates to receive</legend>
        {eventKinds.map(kind => <label className="checkbox-label" key={kind}><input type="checkbox" checked={selectedEvents.includes(kind)} onChange={() => setSelectedEvents(selectedEvents.includes(kind) ? selectedEvents.filter(value => value !== kind) : [...selectedEvents, kind])} />{kind === "incidents" ? "Incidents" : kind === "maintenance" ? "Maintenance" : "Component status changes"}</label>)}
        <label className="checkbox-label"><input type="checkbox" checked={minimumImpact !== null} onChange={event => setMinimumImpact(event.target.checked ? "Partially unavailable" : null)} />Only incidents reaching Partially unavailable or worse</label>
      </fieldset>
      {error ? <FormError>{error}</FormError> : null}
      {result ? <p role="status">{result}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Adding subscriber…" : "Add subscriber and send confirmation"}</Button>
    </form>
  </section>;
}
