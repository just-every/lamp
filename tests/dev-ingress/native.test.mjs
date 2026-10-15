import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { devKeyHeaders } from '../helpers/dev-key.mjs';
import { nativeRequest, openNativeRuntime, operator, origin, port, publicOrigin, rawRequest, subscriber } from './runtime.mjs';

test('native pnpm dev serves local requests through Cloudflare Vite and rejects raw ingress spoofing', { timeout: 600_000 }, async (t) => {
  const runtime = await openNativeRuntime();
  let browser;
  try {
    await runtime.start();
    await runtime.seedOperator();
    t.diagnostic('Native local mail mode is ready.');
    assert.equal((await nativeRequest('/', { host: publicOrigin })).status, 200);
    for (const address of Object.values(networkInterfaces()).flat().filter(item => item && !item.internal && item.family === 'IPv4')) {
      await assert.rejects(fetch(`http://${address.address}:${port}/health`, { signal: AbortSignal.timeout(1000) }), 'native dev has no non-loopback listener');
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
    assert.equal((await rawRequest([`Host: 127.0.0.1:${port}`], `${origin}/health`)).status, 404, 'absolute-form target');
    for (const [path, host] of [['/auth/magic-link', origin], ['/subscribe', publicOrigin]]) {
      assert.equal((await nativeRequest(path, { host, method: 'POST', headers: { 'X-Forwarded-Host': `127.0.0.1:${port}` }, body: new URLSearchParams({ email: operator }) })).status, 404);
    }
    for (const path of ['/__debug', '/__vite_plugin_cloudflare_init__', '/__vite_plugin_cloudflare_get_export_types__', '/cdn-cgi/local/explorer/api/local/workers', '/cdn-cgi/explorer/api/r2/buckets']) {
      assert.equal((await nativeRequest(path)).status, 404, 'private emulator control surface');
    }
    for (const path of ['/', '/health', '/__vite_plugin_cloudflare_init__']) {
      const response = await rawRequest([`Host: 127.0.0.1:${port}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Protocol: arbitrary'], path);
      assert.equal(response.status, 404, 'unsupported WebSocket cannot bypass ingress');
    }
    for (const path of ['/@id/__x00__virtual:lamp-dev-ingress', '/@id/__x00__virtual%3Alamp-dev-ingress', '/@id/%00virtual%3Alamp-dev-ingress', '/@id/virtual:lamp-dev-ingress', '/@id/__x00__virtual:lamp-dev-ingress?ssr=true', '/@id/__x00__virtual:lamp-dev-ingress?environment=ssr', '/@id/__x00__virtual:lamp-dev-ingress?import', '/@id/__x00__virtual:lamp-dev-ingress?raw']) {
      const response = await nativeRequest(path, { headers: { 'Sec-Fetch-Dest': 'script', 'X-Vite-Environment': 'ssr' } });
      const text = await response.text();
      assert.ok(response.status >= 400, 'private virtual module is inaccessible');
      assert.ok(!/const key = ["'][a-f0-9]{64}/.test(text), 'no private key source');
    }
    assert.equal((await nativeRequest('/api/app/components')).status, 401);
  } finally { await browser?.close(); await runtime.close(); }
});
