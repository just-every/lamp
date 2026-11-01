import { useState } from "react";

import { ApiError, appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import type { SignInProviderId, SignInProviderView } from "../types";
import { failureText, PILLS, PROVIDER_COPY } from "./wording";

function meta(provider: SignInProviderView) {
  if (provider.source === "deploy") return "Set in your deploy settings";
  if (provider.source === "none") return "";
  const parts = [provider.id === "okta" ? provider.domain : provider.clientId];
  if (provider.people) parts.push(`${provider.people.length} ${provider.people.length === 1 ? "person" : "people"}`);
  return parts.filter(Boolean).join(" · ");
}

/** Google and Okta as compact rows: name, one quiet line, state, then Set up or Edit and Disconnect. */
export function ProviderRows({ providers, canEdit, unavailable, editing, onEdit, onChanged, onStale }: { providers: SignInProviderView[]; canEdit: boolean; unavailable: string | null; editing: SignInProviderId | null; onEdit: (id: SignInProviderId) => void; onChanged: (disconnected: SignInProviderId) => void; onStale: () => void }) {
  return <section className="data-card connected-tools" aria-labelledby="sign-in-providers-title">
    <h2 id="sign-in-providers-title">Providers</h2>
    <ul className="tool-list">{providers.map(provider => <ProviderRow key={provider.id} provider={provider} canEdit={canEdit} unavailable={unavailable} editing={editing === provider.id} onEdit={() => onEdit(provider.id)} onDisconnected={() => onChanged(provider.id)} onStale={onStale} />)}</ul>
  </section>;
}

function ProviderRow({ provider, canEdit, unavailable, editing, onEdit, onDisconnected, onStale }: { provider: SignInProviderView; canEdit: boolean; unavailable: string | null; editing: boolean; onEdit: () => void; onDisconnected: () => void; onStale: () => void }) {
  const { name } = PROVIDER_COPY[provider.id];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pill = PILLS[provider.status];
  const line = meta(provider);
  async function disconnect() {
    setBusy(true); setError(null);
    try { await appApi(`/api/app/sign-in/${provider.id}`, { method: "DELETE" }); setConfirming(false); onDisconnected(); }
    catch (cause) {
      const code = cause instanceof ApiError ? cause.message : "";
      setError(failureText(code, provider.id, unavailable));
      if (code === "step_up_required") onStale();
    }
    finally { setBusy(false); }
  }
  const verb = provider.source === "none" ? "Set up" : "Edit";
  return <li className={`tool-row${editing ? " is-open" : ""}`} aria-label={name} data-provider={provider.id} data-status={provider.status} data-source={provider.source}>
    <span className="tool-row-name"><strong>{name}</strong>{line && <small>{line}</small>}</span>
    <span className={`state-pill ${pill.tone}`}>{pill.label}</span>
    {canEdit && <span className="tool-row-actions">
      <Button type="button" variant="secondary" className="table-action" aria-label={`${verb} ${name}`} aria-expanded={editing} disabled={provider.source === "none" && Boolean(unavailable)} onClick={onEdit}>{verb}</Button>
      {provider.source === "app" && <Button type="button" variant="secondary" className="table-action" aria-label={`Disconnect ${name}`} disabled={busy} onClick={() => setConfirming(true)}>Disconnect</Button>}
    </span>}
    {confirming && <div className="tool-confirm" role="group" aria-label={`Disconnect ${name}?`}>
      <p>Disconnect {name}? People signed in with {name} are signed out. Email sign-in links keep working.</p>
      <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep</Button><Button type="button" variant="secondary" className="danger-button" disabled={busy} onClick={() => void disconnect()}>{busy ? "Disconnecting…" : `Disconnect ${name}`}</Button></div>
      {error && <FormError>{error}</FormError>}
    </div>}
  </li>;
}
