import { secret } from '../../auth-adoption/runtime.mjs';
// The wrangler template's local hostnames, both served on one port: the app host answers the landing page at `/`,
// sign-in and the operator app; the page host answers the public status page at `/` and its public paths.
export const appHost = "127.0.0.1";
export const pageHost = "localhost";
export const appOrigin = (port) => {
  const origin = `http://${appHost}:${port}`;
  Object.assign(process.env, {AUTH_ORIGIN:origin,AUTH_LOCAL:'true',SESSION_SECRET:secret,SETUP_OPERATOR_EMAIL:'operator@example.test'});
  return origin;
};
export const pageOrigin = (port) => `http://${pageHost}:${port}`;
