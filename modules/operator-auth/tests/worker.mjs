// Test-only fixture transport and trusted-verifier probes. Never exported from
// the module or deployed by an application.
import { createOperatorAuth, createAuthHandler, AuthError, defaultRolePolicy } from '../index.mjs';
export default {
  async fetch(envelope, env) {
    const { url, ...init } = await envelope.json();
    const request = new Request(url, init);
    const config = JSON.parse(env.TEST_CONFIG);
    const options = JSON.parse(env.TEST_OPTIONS);
    const mailSender = options.noMail ? undefined : { async send(message) {
      if (options.mailThrows) throw new Error('fixture provider rejected secret');
      await env.DB.prepare('INSERT INTO test_mail(message) VALUES(?)').bind(JSON.stringify(message)).run();
      return { provider: 'fixture', status: options.mailStatus ?? 'accepted', providerMessageId: 'fixture' };
    } };
    const auth = createOperatorAuth({ db: env.DB, config, mailSender,
      clock: options.now === undefined ? undefined : () => options.now,
      clientIp: (request) => request.headers.get('X-Test-IP'),
      rolePolicy: options.denyInvites ? (input) => input.action !== 'operators:invite' && defaultRolePolicy(input) : undefined,
    });
    try {
      const path = new URL(request.url).pathname;
      if (path === '/test/credentials') return Response.json(await auth.mintCredential(request, await request.json()), { status: 201 });
      if (path === '/test/credential-use') return new Response(null, { status: await auth.authenticateCredential(request) ? 200 : 401 });
      if (path === '/test/external') {
        const input = await request.json();
        const result = await auth.admitVerifiedIdentity(request, input.identity, { returnTo: input.returnTo });
        return Response.json({ operator: result.operator, session: result.session }, { headers: { 'Set-Cookie': result.cookie } });
      }
      if (path === '/test/password') {
        const input = await request.json();
        const result = await auth.admitVerifiedPassword(request, input.operatorId);
        return Response.json({ operator: result.operator, session: result.session }, { headers: { 'Set-Cookie': result.cookie } });
      }
      if (path.startsWith('/private/')) {
        const session = await auth.getSession(request);
        if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 });
        return path === '/private/known' ? Response.json({ private: true }) : new Response('Not found', { status: 404 });
      }
      return await createAuthHandler(auth)(request) ?? new Response('Not found', { status: 404 });
    } catch (error) {
      if (error instanceof AuthError) return Response.json({ error: error.code }, { status: error.status });
      throw error;
    }
  },
};
