import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import type { SignInProviderId, SignInProviderView } from "../types";
import { PROVIDER_COPY, resultText } from "./wording";

/** The provider's real flow, started by a plain form post. It comes back to this pane with the outcome in the address. */
export function TestSignIn({ provider, enabled }: { provider: SignInProviderId; enabled: boolean }) {
  return <form className="tool-step" method="post" action={`/auth/oidc/${provider}/start`}>
    <input type="hidden" name="returnTo" value={`/app/settings?test=${provider}#sign-in`} />
    <p>{PROVIDER_COPY[provider].test}</p>
    <div className="form-actions"><Button disabled={!enabled}>Test sign-in</Button></div>
    {!enabled && <p className="tool-note">Turn on provider sign-in to test.</p>}
  </form>;
}

export type TestOutcome = { provider: SignInProviderId; code: string | null };

/** The outcome in the address, read once the page is live. */
export function testOutcome(search: string): TestOutcome | null {
  const params = new URLSearchParams(search);
  const provider = params.get("test");
  if (provider !== "google" && provider !== "okta") return null;
  const code = params.get("result");
  return { provider, code: code && /^[a-z_]+$/.test(code) ? code : null };
}

/** One plain line. Success shows only while the provider reads Working; a failure always shows. */
export function TestResult({ outcome, view }: { outcome: TestOutcome; view: SignInProviderView | undefined }) {
  if (outcome.code) return <FormError>{resultText(outcome.code, outcome.provider)}</FormError>;
  return view?.status === "working" ? <p className="tool-note" role="status">{resultText(null, outcome.provider)}</p> : null;
}
