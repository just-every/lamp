import { isLoopbackHostname } from '../../features/dev-outbox/access';
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
  return env.AUTH_ORIGIN || env.LAMP_LOCAL_ORIGIN || `https://${env.LAMP_APP_HOST}`;
}

export function authConfig(env: AppBindings): AuthConfig {
  const origin = authOrigin(env);
  return {
    origin, local: env.AUTH_LOCAL === 'true' || Boolean(env.LAMP_LOCAL_ORIGIN && isLoopbackHostname(new URL(origin).hostname)),
    OWNER_EMAIL: (env.SETUP_OPERATOR_EMAIL || env.OWNER_EMAIL)!, SESSION_SECRET: env.SESSION_SECRET!, SETUP_TOKEN: env.SETUP_TOKEN,
    MAIL_FROM: env.MAIL_FROM_ADDRESS, linkSeconds: 20 * 60,
    branding: { productName: 'Lamp', accentColor: '#163c60', signInPath: '/signin', theme: '/rer-theme.css' },
    dependencies: true, OIDC_TRANSACTION_SECRET: env.OIDC_TRANSACTION_SECRET,
    providers: providers(env.AUTH_PROVIDERS),
  };
}
