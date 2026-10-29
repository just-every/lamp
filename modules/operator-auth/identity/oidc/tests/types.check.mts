import { createOperatorAuth, createAuthHandler, createSignInHandler, type Database, type IdentityProviderConfig } from '../../../index.mjs';
import { createOidcProviders, createOidcHandler } from '../index.mjs';
declare const db: Database;
declare const privateKey: JsonWebKey & { kid: string };
const providers: IdentityProviderConfig[] = [
  { id: 'auth', preset: 'auth', issuer: 'https://id.example', clientId: 'app', privateKey },
  { id: 'google', preset: 'google', clientId: 'app', tokenAuthMethod: 'client_secret_basic', clientSecret: 'server-binding' },
];
const auth = createOperatorAuth({ db, config: { origin: 'https://app.example', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-server-owned-secret', OIDC_TRANSACTION_SECRET: 'test-server-owned-transaction-secret', providers }, clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' });
const page: Promise<Response | null> = createSignInHandler(auth, { setup: () => ({ instructions: 'Use the setup token.' }) })(new Request('https://app.example/signin'));
const routes: Promise<Response | null> = createAuthHandler(auth)(new Request('https://app.example/auth/oidc/auth/start'));
const direct = createOidcProviders({ admission: auth.admission, db, clientIp: () => '192.0.2.1', config: { origin: 'https://app.example', transactionSecret: 'test-server-owned-transaction-secret', providers } });
const handled: Promise<Response | null> = createOidcHandler(direct)(new Request('https://app.example/auth/oidc/google/callback'));
// @ts-expect-error GitHub is not offered.
const github: IdentityProviderConfig = { id: 'github', preset: 'github', clientId: 'app' };
void page; void routes; void handled; void github;
