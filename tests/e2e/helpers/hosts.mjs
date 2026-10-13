import { secret } from '../../auth-adoption/runtime.mjs';
import { isolatedWranglerConfig } from '../../helpers/wrangler-config.mjs';
let fixtureConfig;
process.once('exit', () => fixtureConfig?.cleanup());
// The wrangler template's local hostnames, both served on one port: the app host answers the landing page at `/`,
// sign-in and the operator app; the page host answers the public status page at `/` and its public paths.
export const appHost = "127.0.0.1";
export const pageHost = "localhost";
export const appOrigin = (port) => {
  const origin = `http://${appHost}:${port}`;
  // Native-session fixtures must never load the installed owner's .dev.vars.
  // Wrangler secrets override config vars, including the fixture session key.
  for (const key of ['RER_DEV_ORIGIN', 'RER_DEV_KEY', 'RER_DEV_IDENTITY']) delete process.env[key];
  Object.assign(process.env, {AUTH_ORIGIN:origin,AUTH_LOCAL:'true',SESSION_SECRET:secret,SETUP_OPERATOR_EMAIL:'operator@example.test',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'});
  if (fixtureConfig) fixtureConfig.write();
  else fixtureConfig = isolatedWranglerConfig();
  process.env.LAMP_WRANGLER_CONFIG = fixtureConfig.path;
  return origin;
};
export const pageOrigin = (port) => `http://${pageHost}:${port}`;
