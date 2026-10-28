// Test-only transport: the real auth handler wrapped by the real local dev layer.
import { createOperatorAuth, createAuthHandler } from '../index.mjs';
import { withDevIdentity } from '../dev/index.mjs';

export const config = env => JSON.parse(env.TEST_CONFIG);
const mailSender = env => ({ async send(message) {
  await env.DB.prepare('INSERT INTO test_mail(message) VALUES(?)').bind(JSON.stringify(message)).run();
  return { provider: 'fixture', status: 'accepted', providerMessageId: null };
} });
export const app = {
  async fetch(request, env) {
    const auth = createOperatorAuth({ db: env.DB, config: config(env), clientIp: () => '192.0.2.1', mailSender: mailSender(env) });
    return await createAuthHandler(auth)(request)
      ?? new Response('<!doctype html><html><body><main>app</main></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'" } });
  },
};
const local = withDevIdentity(app, { config, personas: () => [{ as: 'admin', role: 'admin', displayName: 'Dev admin' }] });
export default {
  async fetch(envelope, env, execution) {
    const { url, ...init } = await envelope.json();
    return local.fetch(new Request(url, init), env, execution);
  },
};
