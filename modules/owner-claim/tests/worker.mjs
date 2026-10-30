// Test-only exact-request envelope. Production code, crypto and D1 execute in workerd.
import { createOwnerClaimHandler } from '../index.mjs';
import { createOperatorAuth, createAuthHandler } from '../../operator-auth/index.mjs';
export default {
  async fetch(envelope, env) {
    const { url, ...init } = await envelope.json();
    const request = new Request(url, init);
    const options = JSON.parse(env.TEST_CONFIG);
    const { now } = JSON.parse(env.TEST_OPTIONS);
    const clock = now === undefined ? undefined : () => now;
    const clientIp = request => request.headers.get('X-Test-IP');
    const response = await createOwnerClaimHandler({ db: env.DB, ...options, clientIp, clock })(request);
    if (response) return response;
    const auth = createOperatorAuth({ db: env.DB, config: options.authConfig, clientIp, clock });
    if (new URL(request.url).pathname === '/app') return new Response(await auth.getSession(request) ? 'Signed in' : 'Unauthorized', { headers: { 'Content-Type': 'text/plain' } });
    return await createAuthHandler(auth)(request) ?? new Response('Not found', { status: 404 });
  },
};
