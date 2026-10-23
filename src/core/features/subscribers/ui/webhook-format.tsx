export type WebhookFormat = "lamp" | "statuspage";

export function WebhookFormatLabel({ channel, format }: { channel: string; format: WebhookFormat | null }) {
  return channel === "webhook" ? <small>{format === "statuspage" ? "Statuspage" : "Lamp"} format</small> : null;
}

export function WebhookFormatChoice({ value, onChange, disabled }: { value: WebhookFormat; onChange: (value: WebhookFormat) => void; disabled: boolean }) {
  return <label className="form-label">Webhook body format
    <select aria-label="Webhook body format" value={value} disabled={disabled} onChange={event => onChange(event.target.value as WebhookFormat)}>
      <option value="lamp">Lamp</option><option value="statuspage">Statuspage</option>
    </select>
    <small>Choose the body your receiver expects. Both formats carry the same signature headers.</small>
  </label>;
}
