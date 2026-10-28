// The real demo, signed owner claim and auth routes behind an exact-request
// envelope, so hosted Host/Origin/cookies reach workerd unchanged.
import { withDemo } from '../../demo/index.mjs';
import { createOwnerClaimHandler } from '../../owner-claim/index.mjs';
import { createOperatorAuth, createAuthHandler } from '../index.mjs';

const app = withDemo({
  async fetch(request, env) {
    const options = JSON.parse(env.TEST_CONFIG);
    const clientIp = () => '192.0.2.1';
    const claimed = await createOwnerClaimHandler({ db: env.DB, ...options, clientIp })(request);
    if (claimed) return claimed;
    const auth = createOperatorAuth({ db: env.DB, config: options.authConfig, clientIp,
      mailSender: { async send(message) {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message),
        });
        return { status: response.status === 202 ? 'accepted' : 'rejected' };
      } },
    });
    return await createAuthHandler(auth)(request) ?? new Response('Not found', { status: 404 });
  },
});

export default {
  async fetch(envelope, env, execution) {
    const { url, ...init } = await envelope.json();
    return app.fetch(new Request(url, init), env, execution);
  },
};
