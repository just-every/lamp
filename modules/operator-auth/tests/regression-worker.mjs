// Test-only runtime: actual auth and D1, an in-D1 mail recorder, configurable
// product policy and a barrier for deterministic policy/transaction races.
import { createOperatorAuth, createAuthHandler, defaultRolePolicy } from '../index.mjs';

export default {
  async fetch(envelope, env) {
    const { url, ...init } = await envelope.json();
    const request = new Request(url, init);
    const config = JSON.parse(env.TEST_CONFIG);
    const options = JSON.parse(env.TEST_OPTIONS);
    const auth = createOperatorAuth({ db: env.DB, config,
      clientIp: () => '192.0.2.1',
      mailSender: { async send(message) {
        await env.DB.prepare('INSERT INTO test_mail(message) VALUES(?)').bind(JSON.stringify(message)).run();
        return { status: 'accepted', provider: 'test', providerMessageId: null };
      } },
      async rolePolicy(input) {
        const allowed = input.action === 'operators:invite' && options.policy === 'deny-invites' ? false
          : (options.policy === 'member-invites-admin' && input.action === 'operators:invite' && input.actor.role === 'member' && input.role === 'admin') || defaultRolePolicy(input);
        const pause = request.headers.get('X-Test-Pause-Policy');
        if (pause && input.action === 'operators:invite') {
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
