import { isLoopbackHostname } from '../development/access';
import { AuthError, type AuthConfig } from '@runeditrun/rer/modules/operator-auth';
import type { AppBindings } from '../../app/types';

function providers(value?: string): AuthConfig['providers'] {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new AuthError('invalid_configuration', 503); }
}

// Origins come only from installation bindings. Request headers never configure authority.
export function authOrigin(env: AppBindings): string {
  return env.RER_DEV_ORIGIN || env.LAMP_LOCAL_ORIGIN || env.AUTH_ORIGIN || `https://${env.LAMP_APP_HOST}`;
}

const MAX_PROVIDERS = 8;

/** The deploy file's providers first, then the ones set up in Settings whose id the deploy file does not use. */
function allProviders(env: AppBindings, stored: AuthConfig['providers']): AuthConfig['providers'] {
  const deploy = providers(env.AUTH_PROVIDERS) ?? [];
  const taken = new Set(deploy.map(provider => provider.id));
  const all = [...deploy, ...(stored ?? []).filter(provider => !taken.has(provider.id))].slice(0, MAX_PROVIDERS);
  return all.length ? all : undefined;
}

/** The providers the deploy file names, read leniently for the Settings pane: a malformed file reads as none here
 * (Base refuses it on every /auth request on its own). */
export function deployProviders(env: AppBindings): Array<{ id: string; clientId?: string; issuer?: string }> {
  try { return (providers(env.AUTH_PROVIDERS) ?? []).filter(provider => typeof provider?.id === 'string'); } catch { return []; }
}

export function authConfig(env: AppBindings, stored: AuthConfig['providers'] = []): AuthConfig {
  const origin = authOrigin(env);
  return {
    origin, local: env.AUTH_LOCAL === 'true' || Boolean(env.LAMP_LOCAL_ORIGIN && isLoopbackHostname(new URL(origin).hostname)),
    OWNER_EMAIL: (env.SETUP_OPERATOR_EMAIL || env.OWNER_EMAIL)!, SESSION_SECRET: env.SESSION_SECRET!, SETUP_TOKEN: env.SETUP_TOKEN,
    MAIL_FROM: env.MAIL_FROM_ADDRESS, linkSeconds: 20 * 60,
    branding: { productName: 'Lamp', accentColor: '#163c60', signInPath: '/signin', theme: '/rer-theme.css' },
    dependencies: true,
    // A Worker that Lamp 1.6.0 or earlier deployed without one holds it empty, and redeploys keep it.
    // Empty means unset: derive a distinct stable value from the kept session
    // secret, as Base does for the Auth dependency.
    OIDC_TRANSACTION_SECRET: env.OIDC_TRANSACTION_SECRET || `${env.SESSION_SECRET}-oidc`,
    providers: allProviders(env, stored),
  };
}
