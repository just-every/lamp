import { createOperatorAuth, createAuthHandler, AuthError } from '../../index.mjs';

export default {
  async fetch(envelope, env) {
    const { url, ...init } = await envelope.json();
    const request = new Request(url, init);
    const config = JSON.parse(env.TEST_CONFIG);
    const options = JSON.parse(env.TEST_OPTIONS);
    const mailSender = options.noMail ? undefined : {
      async send(message) {
        await env.DB.prepare('INSERT INTO conformance_mail(message) VALUES(?)').bind(JSON.stringify(message)).run();
        const accepted = options.mailStatus === 'accepted';
        return {
          provider: 'resend',
          status: options.mailStatus,
          providerMessageId: accepted ? 'test-only-provider-receipt' : null,
          ...(accepted ? {} : { code: `test_${options.mailStatus}` }),
        };
      },
    };
    const auth = createOperatorAuth({
      db: env.DB,
      config,
      mailSender,
      clientIp: (value) => value.headers.get('X-Test-IP') ?? '',
    });

    try {
      const path = new URL(request.url).pathname;
      if (path === '/__conformance/private') {
        const session = await auth.getSession(request);
        return session
          ? Response.json({ authenticated: true, email: session.operator.email })
          : Response.json({ error: 'unauthenticated' }, { status: 401 });
      }
      if (path === '/__conformance/oidc-admit') {
        const input = await request.json();
        const result = await auth.admitVerifiedIdentity(request, input.identity, { returnTo: input.returnTo });
        return Response.json({ session: result.session, operator: result.operator, returnTo: result.returnTo }, { headers: { 'Set-Cookie': result.cookie } });
      }
      return await createAuthHandler(auth)(request) ?? new Response('Not found', { status: 404 });
    } catch (error) {
      if (error instanceof AuthError) return Response.json({ error: error.code }, { status: error.status });
      return Response.json({ error: 'test_worker_error' }, { status: 503 });
    }
  },
};
