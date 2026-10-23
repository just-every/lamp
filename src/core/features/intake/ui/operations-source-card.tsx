import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import type { AlertSourceEndpointView } from "../service";

const connectionLabels = { connected: "Connected", reconnect: "Reconnect required", "not-connected": "Not connected" };

export function OperationsSourceCard({ source, disabled, onEdit, onReconnect, onErased }: {
  source: AlertSourceEndpointView;
  disabled: boolean;
  onEdit: () => void;
  onReconnect: () => void;
  onErased: () => void;
}) {
  const tool = source.preset === "jsm" ? "JSM" : "Opsgenie";
  const [confirming, setConfirming] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function erase() {
    setErasing(true); setError(null);
    try {
      await appApi(`/api/app/intake/sources/${source.id}`, { method: "DELETE" });
      onErased();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `The ${tool} source could not be erased.`);
    } finally { setErasing(false); }
  }

  return <article className="preset-created alert-source-card" aria-label={`${tool} source ${source.name}`}>
    <div><p className="card-kicker">{tool} source</p><h3>{source.name}</h3></div>
    <div><p className="card-kicker">Inbound webhook</p><span className={`state-pill ${source.webhookConnected ? "state-active" : "state-monitoring"}`}>{source.webhookConnected ? "Bearer token configured" : "Awaiting bearer token"}</span>
      <p>Send alert webhooks to this endpoint with the saved token in the <code>Authorization: Bearer</code> header. The token is never displayed again.</p>
    </div>
    <label className="form-label">{source.name} endpoint<input readOnly value={source.endpointUrl} onFocus={event => event.target.select()} /></label>
    <dl className="alert-source-facts">
      <div><dt>Component mappings</dt><dd>{source.labelMatchers?.length ?? 0} exact tag or entity rules</dd></div>
      <div><dt>Responder connection</dt><dd>
        <span className={`state-pill ${source.responderConnection === "connected" ? "state-active" : source.responderConnection === "reconnect" ? "state-failed" : "state-monitoring"}`}>{connectionLabels[source.responderConnection]}</span>
        <p>{source.responderConnection === "connected"
          ? `Published updates send their text and permalink back as a ${tool} alert note.`
          : source.responderConnection === "reconnect"
            ? `Re-enter ${tool} credentials after a restore or credential failure to resume outbound notes. Inbound webhooks keep their separate bearer token.`
            : `Connect optional ${tool} API credentials to send publication notes. Inbound alerts work independently.`}</p>
      </dd></div>
      <div><dt>Close alert on resolve</dt><dd>{source.closeAlertOnResolve ? "Enabled: a Resolved publication also closes the linked alert when outbound credentials are connected." : "Off: Lamp does not close the linked alert when you publish Resolved."}</dd></div>
    </dl>
    <div className="form-actions">
      <Button type="button" variant="secondary" disabled={disabled || erasing} onClick={onEdit}>Edit mappings and token for {source.name}</Button>
      <Button type="button" variant="secondary" disabled={disabled || erasing} onClick={onReconnect}>{source.responderConnection === "not-connected" ? `Connect ${tool} outbound notes` : `Reconnect ${tool}`}</Button>
      <Button type="button" variant="secondary" disabled={disabled || erasing} onClick={() => setConfirming(true)}>Erase source</Button>
    </div>
    {confirming && <div><p>Permanently erase {source.name}, its saved credentials, and its intake receipts? This cannot be undone.</p><div className="form-actions">
      <Button type="button" variant="secondary" disabled={erasing} onClick={() => setConfirming(false)}>Keep source</Button>
      <Button type="button" disabled={disabled || erasing} onClick={erase}>{erasing ? "Erasing…" : "Permanently erase source"}</Button>
    </div></div>}
    {error && <FormError>{error}</FormError>}
  </article>;
}
