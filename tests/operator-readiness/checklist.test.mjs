import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {authFixture} from '../auth-adoption/runtime.mjs';
import { Hono } from 'hono';
import { database, load } from './runtime.mjs';
import { openSnapshotCacheRuntime } from '../e2e/snapshot-cache-runtime.mjs';

test('Lamp checks its own page, subscribe form and sender: real D1 facts, no local sender completion, subscription privacy, checks bound to the current address, and provider-only sender verification', async () => {
  const dir = await mkdtemp(join(process.cwd(), '.lamp-readiness-checklist-'));
  let runtime, cache;
  try {
    const storage = await database(dir); runtime = storage.runtime;
    const { db, bucket, baseMail } = storage;
    const { createOverviewRepository } = await load('src/core/features/overview/repository.ts');
    const { createLiveStatusService } = await load('src/core/features/overview/live-status.ts');
    const { createPageSettingsRepository } = await load('src/core/features/page-settings/repository.ts');
    const { createAppServices } = await load('src/core/app/services.ts');
    const { createR2BlobStore } = await load('src/core/platform/blobs/r2.ts');
    const { createOverviewService } = await load('src/core/features/overview/service.ts');
    cache = await openSnapshotCacheRuntime(dir);
    const { developmentMail } = await load('src/core/platform/mail/development.ts');
    const { registerOverviewRoutes } = await load('src/core/features/overview/routes.ts');
    const { senderEvidenceKey } = await load('src/core/features/overview/sender-check.ts');
    const { registerDeliveryRoutes } = await load('src/core/features/deliveries/routes.ts');
    const { registerSubscriberRoutes } = await load('src/core/features/subscribers/routes.ts');
    const { createSubscribersService } = await load('src/core/features/subscribers/service.ts');
    const { createSubscriberRepository } = await load('src/core/features/subscribers/repository.ts');
    const { requireOperator } = await load('src/core/features/operators/routes.ts');
    const origin = 'http://127.0.0.1:4177';
    const mail = developmentMail();
    const settingsRepo = createPageSettingsRepository(db);
    const services = createAppServices({ DB: db, SNAPSHOTS: bucket, SNAPSHOT_CACHE: cache.namespace, LAMP_DEV_OUTBOX: bucket, LAMP_BASE_MAIL: baseMail, LAMP_APP_HOST: '127.0.0.1', LAMP_PAGE_HOST: '127.0.0.1', MAIL_FROM_ADDRESS: 'lamp@localhost.invalid' }, createR2BlobStore(bucket), new Request(origin));
    const settings = services.pageSettings;
    const repo = createOverviewRepository(db);
    // The public page is the network edge: its status and body are the fixture.
    let responseHtml = '<html><body>Public page without form</body></html>', responseStatus = 200, canonicalOrigin = origin, publishedAt = null, pageReads = 0;
    const sender = { local: true, provider: 'resend', mail };
    const live = createLiveStatusService(repo, settings, { publicOrigin: async () => canonicalOrigin, publishedAt: async () => publishedAt, sender, fetcher: async () => { pageReads++; return new Response(responseHtml, { status: responseStatus, headers: { 'Content-Type': 'text/html' } }); } });
    const fixture=authFixture(db,{origin});
    const id='01J00000000000000000000081',time=new Date().toISOString();
    await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES (?,?,'Owner','owner','active',?)").bind(id,'owner@example.test',Date.now()).run();
    const cookie=await fixture.signIn();
    const app = new Hono(); app.use('*',async(c,next)=>{c.env={DB:db};await next();}); app.use('/api/app/*',requireOperator(()=>fixture.auth));
    registerOverviewRoutes(app, createOverviewService(services.components, services.incidents, services.maintenance, live));
    registerDeliveryRoutes(app, services.deliveries, { localMail: true, mailProvider: 'sendgrid', sendGridWebhookPublicKey: 'test-configured-receipt-key' });
    const subscribers = createSubscribersService(createSubscriberRepository(db), { mail, fromAddress: 'lamp@localhost.invalid', tokenSecret: 'synthetic-test-local-subscription-secret' });
    registerSubscriberRoutes(app, subscribers);
    const operatorGet = (path, signedIn = true) => app.request(`${origin}${path}`, { headers: { ...(signedIn ? { Cookie: cookie } : {}), Host: new URL(origin).host } });
    const status = async () => (await (await operatorGet('/api/app/overview/live')).json()).live;
    assert.equal((await operatorGet('/api/app/overview/live', false)).status, 401);
    const firstRun = (body, site = 'same-origin') => app.request(`${origin}/api/app/overview/first-run`, { method: 'POST', headers: { Cookie: cookie, Host: new URL(origin).host, Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': site }, body });
    assert.equal((await firstRun('{}', 'cross-site')).status, 403);
    assert.equal((await firstRun('{"unrecognized":true}')).status, 400);
    // Nothing is published before first run: nothing is checked or reported.
    const fresh = await status();
    assert.deepEqual([fresh.publishedAt, fresh.page, fresh.subscribe, pageReads], [null, null, null, 0]);
    await settings.ensureInitial({ pageName: 'Customer status', tagline: 'Updates for our customers', accentColor: '#165544', timezone: 'Australia/Brisbane', hostname: '127.0.0.1', footerCreditEnabled: true, mailFromAddress: 'lamp@localhost.invalid' });
    // An upgrade can retain the former local-success record. It must never
    // make a suppressed local check look like provider verification.
    await repo.record('sender', await senderEvidenceKey('lamp@localhost.invalid', sender));
    await live.checkSenderIfDue();
    assert.equal((await status()).sender.state, 'local');
    const deliveries = await (await operatorGet('/api/app/deliveries')).json();
    assert.equal(deliveries.mail.local, true);
    assert.equal(deliveries.mail.receiptsConfigured, false);
    const subscribe = async email => {
      const response = await app.request(`${origin}/subscribe`, { method: 'POST', headers: { Accept: 'text/html', Origin: origin }, body: new URLSearchParams({ email }) });
      assert.equal(response.status, 202);
      assert.equal(response.headers.has('set-cookie'), false);
      return response.text();
    };
    const email = 'local-reader@example.test';
    const firstResponse = await subscribe(email);
    assert.equal((await subscribers.list()).find(row => row.destination === email).state, 'pending');
    assert.equal(await subscribe(email), firstResponse);
    for (const state of ['active', 'deactivated']) {
      await db.prepare('UPDATE subscribers SET state = ? WHERE destination = ?').bind(state, email).run();
      assert.equal(await subscribe(email), firstResponse);
    }
    // Published: the page answers but has no subscribe form, so that check fails with its fix.
    publishedAt = new Date(Date.now() - 1000).toISOString();
    let checked = await status();
    assert.equal(checked.page.ok, true);
    assert.equal(checked.subscribe.ok, false);
    assert.match(checked.subscribe.reason, /subscribe form/);
    // A page that does not answer fails both, without throwing.
    responseStatus = 503;
    await live.runChecks();
    checked = await status();
    assert.deepEqual([checked.page.ok, checked.subscribe.ok], [false, false]);
    assert.match(checked.page.reason, /not answering/);
    responseStatus = 200;
    responseHtml = '<html><body><form action="/subscribe" method="post"><input name="email" type="email"><button>Subscribe</button></form></body></html>';
    await live.runChecks();
    checked = await status();
    assert.deepEqual([checked.page.ok, checked.subscribe.ok, checked.page.reason, checked.subscribe.reason], [true, true, null, null]);
    // A fresh check is reused; a new publish makes it stale and Lamp checks again on its own.
    const reads = pageReads;
    await status();
    assert.equal(pageReads, reads);
    publishedAt = new Date(Date.now() + 1000).toISOString();
    await status();
    assert.equal(pageReads, reads + 1);
    await settingsRepo.update({ ...(await settingsRepo.get()), mailFromAddress: 'changed@localhost.invalid', updatedAt: time });
    assert.equal((await status()).sender.state, 'local');
    // Results belong to the address they were read from.
    canonicalOrigin = 'https://new.example.test';
    publishedAt = null;
    const moved = await status();
    assert.deepEqual([moved.publicOrigin, moved.page, moved.subscribe], ['https://new.example.test', null, null]);
    // First run keeps the owner's components once each and stores completion.
    assert.equal((await firstRun(JSON.stringify({ components: ['API', 'Dashboard', 'api'] }))).status, 200);
    assert.deepEqual((await services.components.list()).map(component => component.name), ['API', 'Dashboard']);
    assert.equal(await live.firstRunComplete(), true);
    // Sender completion requires provider authentication and refuses errors and unverified domains.
    {
    const { checkSender } = await load('src/core/features/overview/sender-check.ts');
    const mail = { configured: true, send() { throw new Error('Provider check must not send mail'); } };
    for (const provider of ['sendgrid', 'resend']) {
      const payload = verified => provider === 'sendgrid' ? [{ domain: 'example.test', valid: verified }] : { data: [{ name: 'example.test', status: verified ? 'verified' : 'pending' }], has_more: false };
      const options = { local: false, provider, apiKey: 'test-network-edge-key', mail, fetcher: async () => Response.json(payload(true)) };
      await assert.doesNotReject(checkSender('owner@example.test', 'operator@example.test', options));
      await assert.rejects(checkSender('owner@example.test', 'operator@example.test', { ...options, fetcher: async () => Response.json(payload(false)) }));
      await assert.rejects(checkSender('owner@example.test', 'operator@example.test', { ...options, fetcher: async () => new Response('', { status: 403 }) }));
      let reachedLaterPage = false;
      const paginated = { ...options, fetcher: async (url, init) => {
        assert.equal(init.method ?? 'GET', 'GET');
        assert.equal(init.signal instanceof AbortSignal, true);
        const query = new URL(url).searchParams;
        if (provider === 'sendgrid') {
          assert.equal(query.get('domain'), 'example.test');
          const limit = Number(query.get('limit'));
          const offset = Number(query.get('offset'));
          reachedLaterPage = offset > 0;
          return Response.json(reachedLaterPage
            ? [{ id: offset, domain: 'example.test', valid: true }]
            : Array.from({ length: limit }, (_, id) => ({ id, domain: 'example.test', valid: false })));
        }
        reachedLaterPage = Boolean(query.get('after'));
        return Response.json(reachedLaterPage
          ? { data: [{ id: 'last', name: 'example.test', status: 'verified' }], has_more: false }
          : { data: [{ id: 'first', name: 'example.test', status: 'pending' }], has_more: true });
      } };
      await assert.doesNotReject(checkSender('owner@example.test', 'operator@example.test', paginated));
      assert.equal(reachedLaterPage, true, 'verification can be found beyond the first provider page');
      async function refusesWithinWatchdog(fetcher) {
        let watchdog, fixtureError;
        try {
          const result = await Promise.race([
            checkSender('owner@example.test', 'operator@example.test', { ...options, fetcher: async (...args) => {
              // Yield so a broken unbounded reader cannot starve the watchdog.
              await new Promise(resolve => setImmediate(resolve));
              try { return await fetcher(...args); }
              catch (error) { fixtureError = error; throw error; }
            } }).then(() => 'accepted', () => 'refused'),
            new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('Provider check did not terminate')), 10_000); }),
          ]);
          if (fixtureError) throw fixtureError;
          assert.equal(result, 'refused');
        } finally { clearTimeout(watchdog); }
      }
      let returnedPage = false, returnedRepeatedPage = false;
      await refusesWithinWatchdog(url => {
        returnedRepeatedPage = returnedPage;
        returnedPage = true;
        const limit = Number(new URL(url).searchParams.get('limit'));
        return Response.json(provider === 'sendgrid'
          ? Array.from({ length: limit }, (_, id) => ({ id, domain: 'example.test', valid: false }))
          : { data: [{ id: 'repeated', name: 'example.test', status: 'pending' }], has_more: true });
      });
      assert.equal(returnedRepeatedPage, true, 'the provider actually returned a repeated page before refusal');
      // Distinct pages never finish: refusal must come from the product's bound,
      // not from a fixture exception or the independent failing watchdog.
      let page = 0;
      await refusesWithinWatchdog(url => {
        const id = `unverified-${++page}`;
        const limit = Number(new URL(url).searchParams.get('limit'));
        return Response.json(provider === 'sendgrid'
          ? Array.from({ length: limit }, (_, row) => ({ id: `${id}-${row}`, domain: 'example.test', valid: false }))
          : { data: [{ id, name: 'example.test', status: 'pending' }], has_more: true });
      });
    }
    }
  } finally { await runtime?.dispose(); await cache?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
