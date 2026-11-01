import { useState, type FormEvent } from "react";

import { ApiError, appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { CopyField, ToolHeading } from "../../intake/ui/tool-parts";
import type { SignInProviderView, SignInStatusView } from "../types";
import { emptyPerson, OktaPeople, peopleOf, usePeopleAutosave, type PersonRow } from "./okta-people";
import { TestSignIn } from "./test-sign-in";
import { failureText, PROVIDER_COPY } from "./wording";

/** The one open form. A deploy-set provider has no fields: only its redirect URI and the test. */
export function ProviderForm({ provider, view, onClose, onChanged }: { provider: SignInProviderView; view: SignInStatusView; onClose: () => void; onChanged: () => void }) {
  const copy = PROVIDER_COPY[provider.id];
  const deploy = provider.source === "deploy";
  const saved = provider.source === "app";
  const [clientId, setClientId] = useState(provider.clientId);
  const [domain, setDomain] = useState(provider.domain);
  const [secret, setSecret] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [rows, setRows] = useState<PersonRow[]>(() => provider.people?.length ? provider.people.map(({ operatorId, subject }) => ({ operatorId, subject })) : [emptyPerson()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = usePeopleAutosave(saved && provider.id === "okta", view.unavailable, onChanged);
  const secretNeeded = !provider.secretSaved || replacing;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null);
    const body = { clientId, ...(secret.trim() ? { clientSecret: secret } : {}), ...(provider.id === "okta" ? { domain, people: peopleOf(rows) } : {}) };
    try {
      await appApi(`/api/app/sign-in/${provider.id}`, { method: "PUT", body: JSON.stringify(body) });
      // The secret is write-only: it leaves this field the moment it is saved.
      setSecret(""); setReplacing(false); onChanged();
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.message : "";
      setError(failureText(code, provider.id, view.unavailable));
      if (code === "step_up_required" || code === "owner_required") onChanged();
    } finally { setBusy(false); }
  }

  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={provider.source === "none" ? `Set up ${copy.name}` : copy.name} does={copy.does} close={{ label: "Close", onClick: onClose }} />
    {deploy ? <div className="tool-fields">
      <CopyField label={copy.redirect} value={provider.redirectUri} copy="Copy URI" />
      <TestSignIn provider={provider.id} enabled={view.signInEnabled} />
    </div> : <>
      <form className="tool-fields" onSubmit={save}>
        <div className="tool-step">
          <p>{copy.step}</p>
          {copy.link && <p><a className="text-link" href={copy.link.href} target="_blank" rel="noreferrer">{copy.link.label}</a></p>}
        </div>
        <CopyField label={copy.redirect} value={provider.redirectUri} copy="Copy URI" />
        {provider.id === "okta" && <label className="form-label">Okta domain<input value={domain} placeholder="acme.okta.com" autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={event => setDomain(event.target.value)} /></label>}
        <label className="form-label">Client ID<input value={clientId} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={event => setClientId(event.target.value)} /></label>
        {secretNeeded
          ? <div className="tool-secret">
            <label className="form-label">Client secret<input type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} /></label>
            {replacing && <p className="tool-note">{copy.replaceNote}</p>}
          </div>
          : <p className="tool-note">Client secret saved. Lamp never shows it. <Button type="button" variant="secondary" className="table-action" onClick={() => setReplacing(true)}>Replace secret</Button></p>}
        {provider.id === "okta" && <OktaPeople rows={rows} operators={view.operators} onChange={(next, immediate) => { setRows(next); people.changed(next, immediate); }} save={saved ? people : null} />}
        <div className="form-actions"><Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>
        {error && <FormError>{error}</FormError>}
      </form>
      {saved && provider.secretSaved && <TestSignIn provider={provider.id} enabled={view.signInEnabled} />}
    </>}
  </section>;
}
