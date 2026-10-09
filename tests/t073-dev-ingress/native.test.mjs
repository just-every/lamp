import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { envelopes, nativeRequest, openNativeRuntime, operator, origin, port, rawRequest, subscriber } from './runtime.mjs';

test('native pnpm dev authenticates real local mail through Cloudflare Vite and rejects raw ingress spoofing', { timeout: 600_000 }, async (t) => {
  const runtime = await openNativeRuntime();
  let browser;
  try {
    await runtime.start();
    await runtime.seedOperator();
    t.diagnostic('Native local mail mode is ready.');
    assert.equal((await nativeRequest('/')).status, 200);
    for (const address of Object.values(networkInterfaces()).flat().filter(item => item && !item.internal && item.family === 'IPv4')) {
      await assert.rejects(fetch(`http://${address.address}:${port}/__dev/outbox`, { signal: AbortSignal.timeout(1000) }), 'native dev has no non-loopback listener');
    }
    const legitimate = await rawRequest([`Host: 127.0.0.1:${port}`]);
    assert.equal(legitimate.status, 200);
    assert.doesNotMatch(legitimate.data, /x-lamp-dev-ingress|virtual:lamp-dev-ingress/i);
    for (const name of ['Forwarded', 'X-Forwarded-Host', 'x-FoRwArDeD-For', 'X-Forwarded-Proto', 'X-Original-Host', 'X-Real-IP', 'CF-Connecting-IP', 'MF-Route-Override', '__VITE_ENVIRONMENT_NAME__', 'X-Lamp-Dev-Ingress']) {
      for (const values of [[''], [`127.0.0.1:${port}`], [`127.0.0.1:${port}`, `127.0.0.1:${port}`]]) {
        const response = await rawRequest([`Host: 127.0.0.1:${port}`, ...values.map(value => `${name}: ${value}`)]);
        assert.equal(response.status, 404, `${name} with ${values.length} raw values`);
      }
    }
    for (const host of [`public.example.test:${port}`, `localhost.evil:${port}`, `evil.localhost:${port}`, `localhost.:${port}`, `127.1:${port}`, `2130706433:${port}`, `0x7f000001:${port}`, `127.0.0.2:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1:65536']) {
      assert.equal((await rawRequest([`Host: ${host}`])).status, 404, host);
    }
    for (const extra of [[`Host: 127.0.0.1:${port}`], ['Origin: null'], ['Origin: https://evil.example'], ['Sec-Fetch-Site: cross-site'], [`Origin: ${origin}`, `Origin: ${origin}`]]) {
      assert.equal((await rawRequest([`Host: 127.0.0.1:${port}`, ...extra])).status, 404);
    }
    assert.equal((await rawRequest([`Host: 127.0.0.1:${port}`], `${origin}/__dev/outbox`)).status, 404, 'absolute-form target');
    for (const path of ['/signin/request', '/subscribe']) {
      assert.equal((await nativeRequest(path, { method: 'POST', headers: { 'X-Forwarded-Host': `127.0.0.1:${port}` }, body: new URLSearchParams({ email: operator }) })).status, 404);
    }
    assert.equal((await envelopes()).length, 0, 'rejected ingress produces no native capture');
    for (const path of ['/__debug', '/__vite_plugin_cloudflare_init__', '/__vite_plugin_cloudflare_get_export_types__', '/cdn-cgi/local/explorer/api/local/workers', '/cdn-cgi/explorer/api/r2/buckets']) {
      assert.equal((await nativeRequest(path)).status, 404, 'private emulator control surface');
    }
    for (const path of ['/', '/__dev/outbox', '/__vite_plugin_cloudflare_init__']) {
      const response = await rawRequest([`Host: 127.0.0.1:${port}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Protocol: arbitrary'], path);
      assert.equal(response.status, 404, 'unsupported WebSocket cannot bypass ingress');
    }
    for (const path of ['/@id/__x00__virtual:lamp-dev-ingress', '/@id/__x00__virtual%3Alamp-dev-ingress', '/@id/%00virtual%3Alamp-dev-ingress', '/@id/virtual:lamp-dev-ingress', '/@id/__x00__virtual:lamp-dev-ingress?ssr=true', '/@id/__x00__virtual:lamp-dev-ingress?environment=ssr', '/@id/__x00__virtual:lamp-dev-ingress?import', '/@id/__x00__virtual:lamp-dev-ingress?raw']) {
      const response = await nativeRequest(path, { headers: { 'Sec-Fetch-Dest': 'script', 'X-Vite-Environment': 'ssr' } });
      const text = await response.text();
      assert.ok(response.status >= 400, 'private virtual module is inaccessible');
      assert.ok(!/const key = ["'][a-f0-9]{64}/.test(text), 'no private key source');
    }
    assert.equal((await nativeRequest('/api/app/components')).status, 401);
    const signIn = email => nativeRequest('/signin/request', { method: 'POST', body: new URLSearchParams({ email }) });
    const unknown = await signIn('unknown@ingress.example.test');
    const known = await signIn(operator);
    assert.equal(unknown.status, 202); assert.equal(known.status, 202);
    assert.equal(await known.text(), await unknown.text(), 'generic sign-in response equality');
    const envelope = (await envelopes()).find(item => item.message.to === operator);
    assert.ok(envelope, 'native sign-in envelope');
    const link = envelope.message.text.match(/http:\/\/\S+\/signin\/complete\/\S+/)?.[0];
    assert.ok(link); assert.equal(new URL(link).origin, origin);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForURL(`${origin}/app`, { timeout: 60_000, waitUntil: 'domcontentloaded' });
    } catch (error) {
      const diagnostic = String(error.message).replaceAll(link, '[captured sign-in link]').replace(/\/signin\/complete\/[^\s"'<>]+/g, '/signin/complete/[redacted]');
      throw new Error(`Native captured sign-in link did not open the protected app: ${diagnostic}`);
    }
    assert.ok((await page.locator('body').innerText()).includes('Lamp'), 'actual Start operator page renders');
    const cookies = await page.context().cookies();
    const cookie = cookies.map(item => `${item.name}=${item.value}`).join('; ');
    assert.equal((await nativeRequest(new URL(link).pathname)).status, 400, 'native magic link is single-use');
    assert.equal((await nativeRequest('/api/app/session', { cookie })).status, 200);
    const subscribe = () => nativeRequest('/subscribe', { method: 'POST', body: new URLSearchParams({ email: subscriber }) });
    const first = await subscribe(); const repeated = await subscribe();
    assert.equal(first.status, 202); assert.equal(repeated.status, 202);
    assert.equal(await first.text(), await repeated.text(), 'generic subscription response equality');
    const confirmation = (await envelopes()).find(item => item.message.to === subscriber);
    const confirmLink = confirmation.message.text.match(/http:\/\/\S+\/confirm-subscription\/\S+/)?.[0];
    assert.ok(confirmLink);
    t.diagnostic('Raw ingress rejection, private module isolation and native browser sign-in passed.');
    await browser.close(); browser = undefined;
    await runtime.stop(); await runtime.start();
    t.diagnostic('Native server restarted with its durable R2 state.');
    assert.ok((await envelopes()).some(item => item.id === confirmation.id), 'R2 envelopes survive a process restart');
    assert.equal((await nativeRequest(new URL(confirmLink).pathname)).status, 200, 'durable token secret validates captured confirmation after restart');
    const componentResponse = await nativeRequest('/api/app/components', { cookie, method: 'POST', json: { groupId: null, name: 'Ingress API', description: '', internal: false, displayOrder: 0, note: '' } });
    assert.equal(componentResponse.status, 201);
    const { component } = await componentResponse.json();
    const incidentResponse = await nativeRequest('/api/app/incidents', { cookie, method: 'POST', json: { title: 'Ingress cron notification', components: [{ componentId: component.id, state: 'Degraded performance' }] } });
    assert.equal(incidentResponse.status, 201);
    const { incident } = await incidentResponse.json();
    assert.equal((await nativeRequest(`/api/app/incidents/${incident.id}/draft`, { cookie, method: 'PUT', json: { lifecycle: 'Investigating', affectedAudience: 'API customers', customerImpact: 'Cron publication is captured locally', whatStillWorks: 'Reads remain available', details: '', nextUpdateAt: new Date(Date.now() + 3600_000).toISOString() } })).status, 200);
    const publishAt = Date.now() + 1500;
    assert.equal((await nativeRequest(`/api/app/incidents/${incident.id}/draft/schedule`, { cookie, method: 'POST', json: { publishAt: new Date(publishAt).toISOString(), channels: ['email'] } })).status, 202);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, publishAt - Date.now() + 100)));
    for (let i = 0; i < 2; i++) assert.equal((await nativeRequest('/cdn-cgi/handler/scheduled')).status, 200, 'actual Cloudflare scheduled handler');
    const deadline = Date.now() + 15_000;
    let notifications = [];
    while (Date.now() < deadline) {
      notifications = (await envelopes()).filter(item => item.message.to === subscriber && item.message.idempotencyKey.startsWith('notification/'));
      if (notifications.length) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].message.text, /Cron publication is captured locally/);
    for (const match of notifications[0].message.text.matchAll(/https?:\/\/[^\s]+/g)) assert.equal(new URL(match[0]).origin, origin, 'cron uses the observed public scheme and port');
    const deliveries = await (await nativeRequest('/api/app/deliveries', { cookie })).json();
    const captured = deliveries.deliveries.find(item => item.localCaptureId === notifications[0].id);
    assert.ok(captured); assert.notEqual(captured.outcome, 'delivered');
    assert.match(await (await nativeRequest('/')).text(), /Cron publication is captured locally/);
    assert.equal((await nativeRequest('/__dev/outbox/configuration/subscriber-token-secret')).status, 404);
    assert.ok(!/const key = ["'][a-f0-9]{64}|x-lamp-dev-ingress:\s*\d{13}\./i.test(runtime.output), 'no key or signature in runtime logs');
    t.diagnostic('Durable confirmation, cron capture, idempotency and canonical notification origin passed.');
  } finally { await browser?.close(); await runtime.close(); }
});
