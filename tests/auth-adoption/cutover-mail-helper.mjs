import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { load } from '../operator-readiness/runtime.mjs';
import { lampRuntime } from './lamp-runtime.mjs';
import { secret } from './runtime.mjs';

const adapters = load('src/core/platform/mail/index.ts');

// Real routes, native authority, sender preparation and D1/R2. Only the remote
// provider boundary is faked; no actual provider/account request is allowed.
export async function exerciseMailPreparation(t, apply) {
  const { SendGridMailSender, ResendMailSender, createMailSendRepository, MailPreparationError } = await adapters;
  for (const failure of ['sendgrid-ledger', 'sendgrid-envelope', 'sendgrid-key', 'sendgrid-ambiguous', 'resend-request', 'resend-ambiguous', 'extension-prepare', 'extension-ambiguous']) await t.test(failure, async t => {
    const r = await lampRuntime(t);
    const imported = await apply(r);
    const rows = (await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results;
    const journal = (await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results;
    let broken = true;
    const remote = [], originalFetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (['api.sendgrid.com', 'api.resend.com'].includes(url.hostname)) {
        remote.push(await request.json());
        if (broken && failure.endsWith('-ambiguous') && !failure.startsWith('extension')) throw Error('Provider acceptance unknown');
        return url.hostname === 'api.sendgrid.com' ? new Response(null, {status: 202}) : Response.json({id: `receipt-${remote.length}`});
      }
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
      throw Error('The invitation proof forbids external network');
    });
    const app = new Hono();
    app.use('/api/app/*', r.modules.requireOperator(() => r.auth));
    r.modules.registerStatuspageImportRoutes(app, r.modules.createStatuspageImportService(r.db, {
      async inviteSubscriber(id, claim) {
        const fromAddress = broken && failure.endsWith('-envelope') ? 'invalid-address' : 'lamp@example.test';
        const apiKey = broken && failure === 'resend-request' ? 'invalid\nheader' : broken && failure === 'sendgrid-key' ? ' ' : 'test-only-key';
        const resend = new ResendMailSender({apiKey, fromAddress});
        const mail = failure.startsWith('sendgrid')
          ? new SendGridMailSender({apiKey, fromAddress}, createMailSendRepository(r.db))
          : failure.startsWith('extension') ? {configured: true, async send(message) {
            if (broken && failure === 'extension-prepare') throw new MailPreparationError(Error('Extension preparation failed'));
            const result = await resend.send(message);
            if (broken) throw Object.assign(Error('Extension acceptance unknown'), {name: 'MailPreparationError', retryable: true});
            return result;
          }} : resend;
        return r.modules.createSubscribersService(r.modules.createSubscriberRepository(r.db), {mail, tokenSecret: secret, fromAddress})
          .inviteImported(id, 'https://page.example.test', 'Test page', claim);
      },
      async publicDataChanged() {},
    }));
    const attempt = () => app.fetch(r.request(`/api/app/statuspage-import/jobs/${imported.job.id}/send-invitations`, {method: 'POST', cookie: r.cookie, body: {}}), r.bindings);
    if (failure === 'sendgrid-ledger') await r.db.prepare("CREATE TRIGGER refuse_ledger_preparation BEFORE INSERT ON mail_send_ledger BEGIN SELECT RAISE(ABORT, 'Local mail ledger unavailable'); END").run();
    assert.equal((await attempt()).status, 409);
    const ambiguous = failure.endsWith('-ambiguous');
    assert.equal((await r.db.prepare('SELECT count(*) n FROM statuspage_import_invites WHERE sent_at IS NOT NULL').first()).n, ambiguous ? 1 : 0);
    assert.equal(remote.length, ambiguous ? 1 : 0, 'preparation failure never reaches the provider');
    broken = false;
    if (failure === 'sendgrid-ledger') await r.db.prepare('DROP TRIGGER refuse_ledger_preparation').run();
    assert.ok((await Promise.all([attempt(), attempt()])).every(response => response.status === 200));
    assert.equal((await attempt()).status, 200);
    assert.equal((await r.db.prepare('SELECT count(*) n FROM statuspage_import_invites WHERE sent_at IS NOT NULL').first()).n, 2);
    const messages = remote;
    assert.equal(messages.length, 2, 'both addresses get one handoff after repair, including concurrent and repeated actions');
    assert.equal(new Set(messages.map(message => JSON.stringify(message.to ?? message.personalizations[0].to))).size, 2);
    assert.deepEqual((await r.db.prepare('SELECT * FROM subscribers ORDER BY id').all()).results, rows);
    assert.deepEqual((await r.db.prepare('SELECT * FROM ik_provenance ORDER BY ordinal').all()).results, journal);
  });
}
