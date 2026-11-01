export const SIGN_IN_PROVIDERS = ["google", "okta"] as const;
export type SignInProviderId = typeof SIGN_IN_PROVIDERS[number];

/** Where a provider's configuration comes from: the app, the deploy file, or nowhere yet. */
export type SignInSource = "none" | "app" | "deploy";
export type SignInStatus = "not-set-up" | "not-tested" | "working" | "needs-secret";

export interface StoredRegistration { id: SignInProviderId; clientId: string; issuer: string | null; sealedSecret: string | null; updatedAt: string }
export interface StoredPerson { providerId: SignInProviderId; subject: string; operatorId: string; email: string; displayName: string; status: string }
export interface PersonInput { operatorId: string; subject: string }

export interface SignInProviderView {
  id: SignInProviderId;
  source: SignInSource;
  status: SignInStatus;
  clientId: string;
  domain: string;
  secretSaved: boolean;
  redirectUri: string;
  people?: Array<{ operatorId: string; subject: string; displayName: string; email: string }>;
}

export interface SignInStatusView {
  canEdit: boolean;
  confirmed: boolean;
  signInEnabled: boolean;
  unavailable: string | null;
  providers: SignInProviderView[];
  /** The people an Okta user ID can be paired with: active and invited operators. Owners only. */
  operators: Array<{ id: string; displayName: string; email: string }>;
}

/** Base's OIDC provider entry as Lamp composes it from a stored registration. */
export interface ComposedProvider {
  id: SignInProviderId;
  preset: SignInProviderId;
  issuer?: string;
  clientId: string;
  tokenAuthMethod: "client_secret_basic";
  clientSecret: string;
  subjectEmails?: Record<string, string>;
}

/** A refusal the pane explains: `code` is the stable word, `status` its HTTP status. */
export class SignInError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 403 | 404 | 409 | 502 | 503) { super(code); }
}
