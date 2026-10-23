import { useState, type FormEvent } from "react";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { SubscriberSelection } from "./subscriber-selection";
import { WebhookFormatChoice, type WebhookFormat } from "./webhook-format";

export function AddSubscriber({ onChanged }: { onChanged: () => void }) {
  const [channel, setChannel] = useState<"email" | "webhook">("email");
  const [email, setEmail] = useState("");
  const [destination, setDestination] = useState("");
  const [webhookFormat, setWebhookFormat] = useState<WebhookFormat>("lamp");
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(null); setResult(null);
    try {
      const input = channel === "email" ? { channel, email, componentIds } : { channel, destination, contactEmail: email, componentIds, webhookFormat };
      const response = await appApi<{ created: boolean; confirmationSent: boolean }>("/api/app/subscribers", { method: "POST", body: JSON.stringify(input) });
      setResult(response.created ? response.confirmationSent ? "Subscriber added as pending. One confirmation invitation was sent." : "Subscriber added as pending. A recent confirmation to this contact prevented another invitation." : response.confirmationSent ? "One confirmation invitation was sent to the pending subscriber." : "This subscriber already exists. Their subscription was preserved and no invitation was sent.");
      setEmail(""); setDestination(""); setComponentIds([]); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The subscriber could not be added."); }
    finally { setPending(false); }
  }
  return <section className="data-card" aria-label="Add subscriber">
    <h2>Add subscriber</h2><p>Your add sends one confirmation invitation. The subscription stays pending until the recipient confirms.</p>
    <form className="incident-note-form" onSubmit={submit}>
      <label className="form-label">Channel<select aria-label="Channel" value={channel} disabled={pending} onChange={event => { setChannel(event.target.value as "email" | "webhook"); setResult(null); }}><option value="email">Email</option><option value="webhook">Webhook</option></select></label>
      {channel === "webhook" ? <label className="form-label">Endpoint URL<input type="url" required disabled={pending} value={destination} onChange={event => setDestination(event.target.value)} /></label> : null}
      <label className="form-label">{channel === "email" ? "Email address" : "Contact email"}<input type="email" required disabled={pending} value={email} onChange={event => setEmail(event.target.value)} /></label>
      {channel === "webhook" ? <WebhookFormatChoice value={webhookFormat} onChange={setWebhookFormat} disabled={pending} /> : null}
      <SubscriberSelection selected={componentIds} onChange={setComponentIds} disabled={pending} />
      {error ? <FormError>{error}</FormError> : null}
      {result ? <p role="status">{result}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Adding subscriber…" : "Add subscriber and send confirmation"}</Button>
    </form>
    <p>SMS subscribers are not available (SUB-013).</p>
  </section>;
}
