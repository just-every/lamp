// Test-only deterministic interleavings. The real auth handler, policy and SQL
// execute in workerd; no production transport, clock or database is replaced.
import { createOperatorAuth, createAuthHandler, defaultRolePolicy } from '../index.mjs';

export default {
  async fetch(envelope, env) {
    const { url, ...init } = await envelope.json();
    const request = new Request(url, init);
    const auth = createOperatorAuth({ db: env.DB, config: JSON.parse(env.TEST_CONFIG),
      clientIp: () => '192.0.2.1',
      mailSender: { async send(message) {
        await env.DB.prepare('INSERT INTO test_mail(message) VALUES(?)').bind(JSON.stringify(message)).run();
        return { status: 'accepted', provider: 'test', providerMessageId: null };
      } },
      async rolePolicy(input) {
        const allowed = defaultRolePolicy(input);
        const pause = request.headers.get('X-Test-Policy-Barrier');
        if (pause) {
          await env.DB.prepare('INSERT INTO test_barriers(id,released) VALUES(?,0)').bind(pause).run();
          const deadline = Date.now() + 10000;
          while (!(await env.DB.prepare('SELECT released FROM test_barriers WHERE id=?').bind(pause).first()).released) {
            if (Date.now() > deadline) throw new Error('Test policy barrier was not released');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        return allowed;
      },
    });
    return await createAuthHandler(auth)(request) ?? new Response('Not found', { status: 404 });
  },
};
