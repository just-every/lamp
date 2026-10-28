import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { runtime } from './runtime.mjs';
import { testKeys, signClaim } from './keys.mjs';
const require = createRequire(new URL('../../../default-seed/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (server.listening) await new Promise(resolve => server.close(resolve)); }

test('Chromium 1440 and 390: opener handshake, memory-only claim, native same-origin POST and session', async () => {
  const keys = await testKeys();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      let app;
      const appServer = createServer(async (req, res) => {
        try {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const body = Buffer.concat(chunks).toString();
          const response = await app.call(req.url, { method: req.method, origin: req.headers.origin ?? '', host: req.headers.host, headers: Object.fromEntries(Object.entries(req.headers).filter(([key]) => !['host', 'origin'].includes(key))), ...(body ? { body } : {}) });
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.writeHead(500); res.end('test transport failed'); }
      });
      const issuerServer = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html lang="en"><title>Installation</title><body>Installation owner</body></html>'); });
      let context;
      try {
        const appOrigin = await listen(appServer);
        const issuer = await listen(issuerServer);
        app = await runtime(keys.publicKey, { origin: appOrigin, local: true }, { appOrigin, issuer });
        const before = await app.snapshot();
        const token = await signClaim(keys.privateKey, { aud: appOrigin, iss: issuer });
        context = await browser.newContext({ viewport: { width, height: 900 } });
        const owner = await context.newPage();
        await owner.goto(issuer);
        await owner.evaluate(({ target, token }) => {
          window.addEventListener('message', event => {
            if (event.origin === target && event.data?.type === 'rer-owner-claim-ready') event.source.postMessage({ type: 'rer-owner-claim', token }, target);
          });
        }, { target: appOrigin, token });
        const opened = context.waitForEvent('page');
        await owner.evaluate(target => window.open(`${target}/auth/owner-claim`, '_blank'), appOrigin);
        const popup = await opened;
        await popup.waitForURL(`${appOrigin}/auth/owner-claim`);
        await popup.waitForLoadState();
        await popup.getByRole('button', { name: 'Claim your workspace' }).waitFor();
        await popup.waitForFunction(() => !document.querySelector('button').disabled);
        assert.equal(popup.url(), `${appOrigin}/auth/owner-claim`);
        assert.deepEqual(await app.snapshot(), before, 'confirmation GET and handshake write zero');
        assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await popup.locator('#email').inputValue(), 'owner@example.com');
        assert.equal(await popup.evaluate(() => localStorage.length + sessionStorage.length), 0);
        assert.equal(await popup.evaluate(() => window.opener), null);
        const posted = popup.waitForResponse(response => response.request().method() === 'POST');
        await popup.getByRole('button', { name: 'Claim your workspace' }).click();
        const response = await posted;
        assert.equal(response.status(), 303);
        const request = response.request();
        const headers = await request.allHeaders();
        assert.equal(headers.origin, appOrigin);
        assert.equal(headers.referer, `${appOrigin}/`);
        assert.equal(request.url(), `${appOrigin}/auth/owner-claim`);
        assert.equal(new URLSearchParams(request.postData()).get('token'), token);
        await popup.waitForURL(`${appOrigin}/app`);
        assert.equal(await popup.locator('body').innerText(), 'Signed in');
        const after = await app.snapshot();
        assert.equal(after.oa_operators.length, 1);
        assert.equal(after.oa_sessions.length, 1);
        assert.equal(after.oc_owner_claims.length, 1);
        assert.ok(!JSON.stringify(after).includes(token));
      } finally {
        await context?.close();
        await close(appServer); await close(issuerServer);
        await app?.close();
      }
    }
  } finally { await browser.close(); }
});
