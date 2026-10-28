// A seed's Worker entry in miniature: the demo guard first, then routes that
// answer an HTML page under a strict CSP, JSON, and a page that sends out.
import { withDemo, fetchDemoRead, demoEffect } from '../index.mjs';

const POLICY = "default-src 'none'; style-src 'self'";
const page = body => new Response(`<!doctype html><html><head><title>App</title></head><body class="app">${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': POLICY } });

export default withDemo({
  async fetch(request, bindings) {
    const { pathname } = new URL(request.url);
    if (pathname === '/json') return Response.json({ ok: true });
    if (pathname === '/read') return fetch(bindings.PUBLIC_URL ?? 'https://public.example/page');
    if (pathname === '/probe') return fetchDemoRead('https://public.example/check', { method: 'POST', body: 'probe' });
    if (pathname === '/send') {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST' });
      return Response.json({ accepted: response.status === 202, id: response.headers.get('x-message-id') });
    }
    if (pathname === '/chat') return fetch('https://slack.com/api/chat.postMessage', { method: 'POST' });
    if (pathname === '/payment') return fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', body: new URLSearchParams({ success_url: 'http://127.0.0.1/paid?session={CHECKOUT_SESSION_ID}' }) });
    if (pathname === '/mail') return fetch(`https://${new URL(request.url).searchParams.get('host')}/v3/mg.example.com/messages`, { method: 'POST' });
    if (pathname === '/webhook') return fetch('https://hooks.example.com/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'record.created' }) });
    if (pathname === '/binding') return Response.json(await demoEffect(() => ({ sent: 'real' }), { sent: 'demo' }));
    return page('<header><span data-rer-name>App</span></header>');
  },
}, { owner: async () => null });
