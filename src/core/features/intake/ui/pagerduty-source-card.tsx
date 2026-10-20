import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import type { AlertSourceEndpointView } from "../service";

const connectionLabels = { connected: "Connected", reconnect: "Reconnect required", "not-connected": "Not connected" };

export function PagerDutySourceCard({ source, disabled, onEdit, onReconnect, onErased }: { source: AlertSourceEndpointView; disabled: boolean; onEdit: () => void; onReconnect: () => void; onErased: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function erase() {
    setErasing(true); setError(null);
    try {
      await appApi(`/api/app/intake/sources/${source.id}`, { method: "DELETE" });
      onErased();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PagerDuty source could not be erased.");
    } finally { setErasing(false); }
  }

  return <article className="preset-created alert-source-card" aria-label={`PagerDuty source ${source.name}`}>
    <div><p className="card-kicker">PagerDuty source</p><h3 style={{ overflowWrap: "anywhere" }}>{source.name}</h3></div>
    <div><p className="card-kicker">Inbound webhook</p><span className={`state-pill ${source.webhookConnected ? "state-active" : "state-monitoring"}`}>{source.webhookConnected ? "Configured" : "Awaiting signing secret"}</span>{!source.webhookConnected && <p>Create a v3 subscription in PagerDuty with this endpoint, then save its generated signing secret. Inbound alerts are refused until then.</p>}</div>
    <label className="form-label">{source.name} endpoint<input readOnly value={source.endpointUrl} onFocus={event => event.target.select()} /></label>
    <dl className="alert-source-facts"><div><dt>Service mappings</dt><dd>{source.labelMatchers?.length ?? 0} exact service rules</dd></div><div><dt>Responder connection</dt><dd><span className={`state-pill ${source.responderConnection === "connected" ? "state-active" : source.responderConnection === "reconnect" ? "state-failed" : "state-monitoring"}`}>{connectionLabels[source.responderConnection]}</span><p>{source.responderConnection === "connected" ? "Publications send an incident note to PagerDuty." : source.responderConnection === "reconnect" ? "The saved API key needs attention. Reconnect to resume publication notes; signed inbound alerts continue." : "Add a PagerDuty REST API key to send publication notes."}</p></dd></div></dl>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={disabled || erasing} onClick={onEdit}>{source.webhookConnected ? `Edit mappings and secret for ${source.name}` : `Add signing secret for ${source.name}`}</Button><Button type="button" variant="secondary" disabled={disabled || erasing} onClick={onReconnect}>{source.responderConnection === "not-connected" ? "Connect responder notes" : "Reconnect PagerDuty"}</Button><Button type="button" variant="secondary" disabled={disabled || erasing} onClick={() => setConfirming(true)}>Erase source</Button></div>
    {confirming && <div><p>Permanently erase {source.name}, its saved credentials, and its intake records?</p><div className="form-actions"><Button type="button" variant="secondary" disabled={erasing} onClick={() => setConfirming(false)}>Keep source</Button><Button type="button" disabled={disabled || erasing} onClick={erase}>{erasing ? "Erasing…" : "Permanently erase source"}</Button></div></div>}
    {error && <FormError>{error}</FormError>}
  </article>;
}
