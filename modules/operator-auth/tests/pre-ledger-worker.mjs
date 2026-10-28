// Test-only transport: real current handlers/crypto/D1, with the public clock seam.
import { createOperatorAuth, createAuthHandler } from '../index.mjs';
import { NOW } from './fixtures/pre-ledger/owner-state.mjs';

export default {
  async fetch(envelope, env) {
    const { url, ...init } = await envelope.json();
    const auth = createOperatorAuth({
      db: env.DB, config: JSON.parse(env.TEST_CONFIG), clock: () => NOW,
      clientIp: () => '192.0.2.1',
      mailSender: { async send(message) {
        await env.DB.prepare('INSERT INTO test_mail(message) VALUES(?)').bind(JSON.stringify(message)).run();
        return { provider: 'fixture', status: 'accepted', providerMessageId: null };
      } },
    });
    return await createAuthHandler(auth)(new Request(url, init)) ?? new Response('Not found', { status: 404 });
  },
};
