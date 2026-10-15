import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getPlatformProxy } from 'wrangler';
import { load } from '../operator-readiness/runtime.mjs';
import { authFixture } from '../auth-adoption/runtime.mjs';

// Ordinary dev suppresses mail. Observe the durable work and invitation claims
// instead of a captured-message viewer. Undo may delete rows, but must add none.
export async function notificationActivity(runtime) {
  const query = `SELECT 'outbox' AS kind,id FROM notification_outbox
    UNION ALL SELECT 'delivery',id FROM notification_deliveries
    UNION ALL SELECT 'invitation',subscriber_id || ':' || sent_at
      FROM statuspage_import_invites WHERE sent_at IS NOT NULL ORDER BY kind,id`;
  const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB',
    '--local', '--config', 'wrangler.jsonc', '--persist-to', runtime.state,
    '--json', '--command', query], { env: runtime.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output)[0].results.map(row => `${row.kind}:${row.id}`);
}

export async function assertNoNewNotifications(runtime, before, message = 'import sends and queues no notifications') {
  const prior = new Set(before);
  assert.deepEqual((await notificationActivity(runtime)).filter(row => !prior.has(row)), [], message);
}

// Exercise hosted invitation effects on the SAME imported D1 data. Pause Vite
// while a binding proxy owns its persisted store. The real owner middleware,
// import route, subscriber tokens and Resend serializer run; only Resend's paid
// HTTP boundary is faked. Restart Vite so the emitted link can be opened there.
export async function sendImportedInvitations(t, runtime, { origin, publicOrigin, operator, jobId }) {
  await runtime.stop();
  let platform, provider;
  try {
    platform = await getPlatformProxy({ configPath: runtime.env.LAMP_WRANGLER_CONFIG ?? 'wrangler.jsonc',
      remoteBindings: false, persist: { path: join(runtime.state, 'v3') } });
    const db = platform.env.DB;
    const [modules, { ResendMailSender }] = await Promise.all([
      load('tests/auth-adoption/adapter.ts'), load('src/core/platform/mail/resend.ts'),
    ]);
    const page = await db.prepare("SELECT page_name,mail_from_address FROM page_settings WHERE id='default'").first();
    const base = authFixture(db, { origin, owner: operator });
    const cookie = await base.signIn();
    const messages = [], fetcher = globalThis.fetch;
    provider = t.mock.method(globalThis, 'fetch', async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.origin === 'https://api.resend.com' && url.pathname === '/emails') {
        const message = await request.json();
        messages.push({ message: { ...message, to: message.to[0] } });
        return Response.json({ id: `import-invitation-${messages.length}` });
      }
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return fetcher(input, init);
      throw new Error('The import invitation proof forbids external network');
    });
    const subscribers = modules.createSubscribersService(modules.createSubscriberRepository(db), {
      mail: new ResendMailSender({ apiKey: 'test-only-resend-key', fromAddress: page.mail_from_address }),
      fromAddress: page.mail_from_address, tokenSecret: runtime.env.SESSION_SECRET,
    });
    const app = new Hono();
    app.use('/api/app/*', modules.requireOperator(() => base.auth));
    modules.registerStatuspageImportRoutes(app, modules.createStatuspageImportService(db, {
      inviteSubscriber: (id, claim) => subscribers.inviteImported(id, publicOrigin, page.page_name, claim),
      async publicDataChanged() { throw new Error('Sending invitations must not publish imported history'); },
    }));
    const send = () => app.fetch(base.request(`/api/app/statuspage-import/jobs/${jobId}/send-invitations`,
      { method: 'POST', cookie, body: {} }), { DB: db });
    const response = await send();
    const invited = { status: response.status, body: await response.json() };
    const repeated = await send();
    assert.equal(repeated.status, 200, 'repeating the owner action succeeds without another handoff');
    return { invited, messages };
  } finally {
    provider?.mock.restore();
    try { await platform?.dispose(); } finally { await runtime.start(); }
  }
}
