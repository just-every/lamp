import { useEffect, useState } from "react";

import { useAppData } from "../../../app/client/ui/api";
import { FormError, LoadingState } from "../../../app/client/ui/states";
import type { SignInProviderId, SignInStatusView } from "../types";
import { ConfirmIdentity } from "./confirm-identity";
import { ProviderForm } from "./provider-form";
import { ProviderRows } from "./provider-rows";
import { SwitchRow } from "./switch-row";
import { TestResult, testOutcome, type TestOutcome } from "./test-sign-in";

/** Settings › Team › Sign-in: Google and Okta set up in the app, each with a Test sign-in that tells the truth. */
export function SignInPane() {
  const { data, error, loading, refresh } = useAppData<SignInStatusView>("/api/app/sign-in");
  const [open, setOpen] = useState<SignInProviderId | null>(null);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  // The outcome of a Test sign-in rides in the address; read it once the page is live.
  useEffect(() => setOutcome(testOutcome(window.location.search)), []);
  // Confirming by email happens in another tab; coming back refreshes what the pane knows.
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  if (loading && !data) return <LoadingState>Loading sign-in…</LoadingState>;
  if (error && !data) return <FormError>{error}</FormError>;
  if (!data) return null;
  const opened = data.providers.find(provider => provider.id === open);
  const changed = () => { setOutcome(null); refresh(); };
  return <>
    {!data.canEdit && <p className="tool-note" role="status">Only the owner can change sign-in.</p>}
    {data.canEdit && data.unavailable && <p className="tool-note" role="status">{data.unavailable}</p>}
    {data.canEdit && !data.confirmed && !data.unavailable && <ConfirmIdentity />}
    <SwitchRow enabled={data.signInEnabled} canEdit={data.canEdit} onSaved={changed} />
    <ProviderRows providers={data.providers} canEdit={data.canEdit} unavailable={data.unavailable} editing={open}
      onEdit={id => setOpen(open === id ? null : id)} onChanged={id => { if (open === id) setOpen(null); changed(); }} onStale={refresh} />
    {outcome && <TestResult outcome={outcome} view={data.providers.find(provider => provider.id === outcome.provider)} />}
    {data.canEdit && opened && <ProviderForm key={`${opened.id}:${opened.source}`} provider={opened} view={data} onClose={() => setOpen(null)} onChanged={changed} />}
    <p className="tool-note"><a className="text-link" href="/auth/settings/identity">Run Edit Run Auth and Microsoft Entra</a></p>
  </>;
}
