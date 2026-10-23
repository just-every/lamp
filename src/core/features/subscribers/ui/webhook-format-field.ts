import type { WebhookFormat } from "../webhook-format";

export function renderWebhookFormatField(format: WebhookFormat | null) {
  return `<label>Webhook format<select name="webhookFormat" aria-label="Webhook format"><option value="lamp"${format === "lamp" ? " selected" : ""}>Lamp</option><option value="statuspage"${format === "statuspage" ? " selected" : ""}>Statuspage</option></select></label>`;
}
