import type { SignInProviderId, SignInStatus } from "../types";

/** The words on the Sign-in pane. Tests never assert them. */
export const PANE_LINE = "Invited people can sign in with Google or Okta. Email sign-in links keep working.";

export const PROVIDER_COPY: Record<SignInProviderId, { name: string; does: string; step: string; redirect: string; link?: { label: string; href: string }; replaceNote: string; test: string }> = {
  google: {
    name: "Google",
    does: "Invited people sign in with their Google account.",
    step: "In Google Cloud, create an OAuth client ID for a web application. Add this redirect URI, then paste the client ID and secret here.",
    redirect: "Redirect URI",
    link: { label: "Open Google Cloud credentials", href: "https://console.cloud.google.com/apis/credentials" },
    replaceNote: "People signed in with Google sign in again.",
    test: "Use your own Google account. If Google shows an error page, check the client ID and redirect URI.",
  },
  okta: {
    name: "Okta",
    does: "Invited people sign in with their Okta account.",
    step: "In Okta, create an OIDC web app. Add this sign-in redirect URI and assign the people who'll use Lamp.",
    redirect: "Sign-in redirect URI",
    replaceNote: "People signed in with Okta sign in again.",
    test: "Use your own Okta account. If Okta shows an error page, check the client ID and redirect URI.",
  },
};

export const PILLS: Record<SignInStatus, { label: string; tone: string }> = {
  "not-set-up": { label: "Not set up", tone: "state-waiting" },
  "not-tested": { label: "Saved, not tested", tone: "state-waiting" },
  working: { label: "Working", tone: "state-active" },
  "needs-secret": { label: "Needs its client secret", tone: "state-degraded-performance" },
};

/** What a refused Save, Disconnect, People change or switch says. */
export function failureText(code: string, provider: SignInProviderId | null, unavailable: string | null): string {
  const name = provider ? PROVIDER_COPY[provider].name : "Sign-in";
  switch (code) {
    case "owner_required": return "Only the owner can change sign-in.";
    case "step_up_required": return "Confirm it's you first.";
    case "provider_unreachable": return provider === "okta" ? "Lamp couldn't reach that Okta domain. Check it and try again." : "Lamp couldn't reach Google. Try again.";
    case "issuer_mismatch": return "Okta answered with a different address. Use the domain from your Okta admin console.";
    case "provider_unsupported": return provider === "okta" ? "Okta's settings for this app don't work with Lamp. Keep Client authentication as Client secret." : "Google's settings for this client don't work with Lamp.";
    case "deploy_configured": return `${name} is set in your deploy settings.`;
    case "outbound_unavailable": return unavailable ?? "Google and Okta sign-in need an outbound connection, which this hosting does not offer yet.";
    case "client_id_required": return "Enter the client ID.";
    case "client_secret_required": return "Paste the client secret.";
    case "domain_required": case "domain_invalid": return "Enter your Okta domain, like acme.okta.com.";
    case "duplicate_person": return "Each Okta user ID can be listed once.";
    case "person_invalid": return "Choose a person and enter their Okta user ID.";
    case "sealing_unavailable": return "This installation has no key to store the secret with.";
    default: return "It couldn't be saved. Try again.";
  }
}

/** The line a Test sign-in leaves on the pane, from `?test=<id>&result=<code>`; no code means the flow finished. */
export function resultText(code: string | null, provider: SignInProviderId): string {
  const name = PROVIDER_COPY[provider].name;
  if (!code) return `${name} sign-in works.`;
  switch (code) {
    case "oidc_admission_denied": return provider === "okta" ? "Okta accepted Lamp, but that person isn't in People." : `${name} accepted Lamp, but that account isn't invited here.`;
    case "oidc_provider_unavailable": return `${name} didn't accept the client secret, or didn't answer. Check the secret and try again.`;
    case "oidc_provider_denied": return `Sign-in was cancelled at ${name}.`;
    case "oidc_sign_in_disabled": return "Turn on provider sign-in, then test again.";
    case "oidc_invalid_correlation": return "The test took too long or finished in another browser. Try again.";
    case "oidc_provider_required": return "A sign-in rule for this email domain asks for another provider.";
    case "oidc_rate_limited": return "Too many tries. Wait a few minutes and test again.";
    default: return "The test didn't finish. Try again.";
  }
}
