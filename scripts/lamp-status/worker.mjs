import { createOperatorAuth } from '@runeditrun/rer/modules/operator-auth';
import { operatorOrigin, withSession } from './session.mjs';
import { observe } from './observe.mjs';

async function check(env, prove = false) {
  const output = await withSession(async () => {
    let link;
    // The same native owner-terminal issuance used by Lamp's signin-link command.
    const auth = createOperatorAuth({ db: env.DB, config: {
      origin: operatorOrigin, local: false, OWNER_EMAIL: env.SETUP_OPERATOR_EMAIL,
      SESSION_SECRET: env.SESSION_SECRET, MAIL_FROM: env.MAIL_FROM_ADDRESS,
      linkSeconds: 1200, branding: { productName: 'Lamp' },
    }, clientIp: () => 'lamp-status-checks', mailSender: { async send(message) {
      link = message.text.match(/https?:\/\/[^\s]+/)?.[0];
      return { status: 'accepted', provider: 'owner-terminal', providerMessageId: null };
    } } });
    await auth.requestMagicLink(new Request(operatorOrigin + '/auth/magic-link', {
      method: 'POST', headers: { Origin: operatorOrigin },
    }), { email: env.SETUP_OPERATOR_EMAIL });
    if (!link) throw new Error('The monitor could not issue its native operator sign-in.');
    return link;
  }, api => observe(api, prove));
  console.log(JSON.stringify(output));
  return output;
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(check(env)); },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      return Response.json({ status: 'ok', source: 'HTTP checks', cadenceMinutes: 5 });
    }
    if (path !== '/run' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (request.headers.get('Authorization') !== `Bearer ${env.LAMP_STATUS_MONITOR_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    try { return Response.json(await check(env, new URL(request.url).searchParams.get('prove') === 'true')); }
    // The caller holds the monitor token; the reason is the monitor's own message, never a link or cookie.
    catch (error) { console.error(error.message); return Response.json({ error: error.message }, { status: 500 }); }
  },
};
