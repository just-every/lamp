// Test-only HTTP host: the real shared handler, crypto and D1 run in workerd.
// Mail is captured in disposable test storage; no provider is contacted.
import { createOperatorAuth, createAuthHandler } from '../index.mjs';

export default {
  async fetch(request, env) {
    const row = await env.DB.prepare('SELECT value FROM browser_config').first();
    const auth = createOperatorAuth({
      db: env.DB,
      config: JSON.parse(row.value),
      clientIp: () => '127.0.0.1',
      mailSender: { async send(message) {
        await env.DB.prepare('INSERT INTO browser_mail(message) VALUES(?)').bind(JSON.stringify(message)).run();
        return { status: 'accepted' };
      } },
    });
    const response = await createAuthHandler(auth)(request);
    if (response) return response;
    if (new URL(request.url).pathname === '/app') {
      const session = await auth.getSession(request);
      return new Response(session ? 'Signed in' : 'Sign in required', { status: session ? 200 : 401 });
    }
    return new Response('Not found', { status: 404 });
  },
};
