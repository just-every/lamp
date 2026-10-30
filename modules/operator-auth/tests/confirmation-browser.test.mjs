import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { browserRuntime, chromium } from './confirmation-browser-runtime.mjs';
import { securityHeaders } from '../http.mjs';

function assertHeaders(headers, policy = 'no-referrer', styled = policy === 'strict-origin') {
  for (const [name, value] of Object.entries(securityHeaders())) {
    if (name === 'Content-Security-Policy' && styled) {
      assert.match(headers.get(name), new RegExp(`^${value}; style-src 'sha256-[A-Za-z0-9+/]{43}='$`));
    } else assert.equal(headers.get(name), name === 'Referrer-Policy' ? policy : value, name);
  }
}

async function state(db) {
  const tables = ['oa_operators', 'oa_tokens', 'oa_sessions', 'oa_limits'];
  return Promise.all(tables.map(async (table) => (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
}

async function clickConfirm(page) {
  const response = page.waitForResponse((value) => value.request().method() === 'POST' && new URL(value.url()).pathname === '/auth/confirm');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  return response;
}

test('Chromium native magic and invitation forms preserve Origin, keep token out of Referer and consume only on POST', async () => {
  const r = await browserRuntime();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const invite of [false, true]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const link = await r.issue({ invite });
        const before = await state(r.db);
        const head = await fetch(link, { method: 'HEAD' });
        assert.equal(head.status, 200);
        assertHeaders(head.headers, 'strict-origin');
        assert.equal(head.headers.get('set-cookie'), null);
        assert.equal(await head.text(), '');
        const preview = await page.goto(link.href);
        assert.equal(preview.status(), 200);
        assertHeaders(new Headers(await preview.allHeaders()), 'strict-origin');
        assert.equal(await preview.headerValue('set-cookie'), null);
        assert.equal(await page.locator('form').getAttribute('action'), '/auth/confirm');
        assert.equal(await page.locator('form').getAttribute('method'), 'post');
        assert.deepEqual(await context.cookies(), []);
        assert.deepEqual(await state(r.db), before, 'GET and HEAD must not write auth state');

        const confirmed = await clickConfirm(page);
        assert.equal(confirmed.status(), 303);
        const sent = await confirmed.request().allHeaders();
        assert.equal(sent.origin, r.origin);
        assert.equal(sent.referer, `${r.origin}/`);
        assert.equal(sent['sec-fetch-site'], 'same-origin');
        assert.equal(confirmed.request().url(), `${r.origin}/auth/confirm`);
        assert.equal(new URLSearchParams(confirmed.request().postData()).get('token'), link.searchParams.get('token'));
        assertHeaders(new Headers(await confirmed.allHeaders()));
        assert.equal(await confirmed.headerValue('location'), '/app?source=confirmation#ready');
        await page.waitForURL(`${r.origin}/app?source=confirmation#ready`);
        assert.equal(await page.locator('body').innerText(), 'Signed in');
        const sessionCookies = await context.cookies();
        assert.equal(sessionCookies.length, 1);
        assert.equal(sessionCookies[0].httpOnly, true);
        assert.equal(sessionCookies[0].sameSite, 'Lax');
        const session = await context.request.get(`${r.origin}/auth/session`);
        assert.equal(session.status(), 200);
        assert.equal((await session.json()).operator.email, invite ? 'invitee@example.com' : 'owner@example.com');
        const replay = await r.post('/auth/confirm', { token: link.searchParams.get('token') });
        assert.equal(replay.status, 400);
        assertHeaders(replay.headers);
        const expired = await fetch(link);
        assert.equal(expired.status, 400);
        assertHeaders(expired.headers, 'no-referrer', true);
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await r.close(); }
});

test('Chromium cross-origin and opaque-origin native forms are denied without consuming the link', async () => {
  const r = await browserRuntime();
  let browser;
  const attacker = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Referrer-Policy': request.url === '/opaque' ? 'no-referrer' : 'strict-origin' });
    response.end('<!doctype html><title>Foreign form</title><form method="post"><input name="token" type="hidden"><button>Confirm</button></form>');
  });
  try {
    attacker.listen(0, '127.0.0.1');
    await once(attacker, 'listening');
    const foreignOrigin = `http://127.0.0.1:${attacker.address().port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const link = await r.issue();
    const before = await state(r.db);
    for (const [path, expectedOrigin] of [['/foreign', foreignOrigin], ['/opaque', 'null']]) {
      await page.goto(`${foreignOrigin}${path}`);
      await page.locator('form').evaluate((form, input) => {
        form.action = input.action;
        form.elements.token.value = input.token;
      }, { action: `${r.origin}/auth/confirm`, token: link.searchParams.get('token') });
      const denied = await clickConfirm(page);
      assert.equal((await denied.request().allHeaders()).origin, expectedOrigin);
      assert.equal(denied.status(), 403);
      assert.deepEqual(await denied.json(), { error: 'invalid_origin' });
      assertHeaders(new Headers(await denied.allHeaders()));
      assert.equal(await denied.headerValue('set-cookie'), null);
      assert.deepEqual(await state(r.db), before);
    }
    // Missing Origin cannot be generated by a modern native POST form, so send
    // it directly over the same HTTP listener. Also retain the Fetch Metadata
    // rejection when a caller supplies an otherwise exact Origin.
    for (const headers of [{}, { Origin: 'null' }, { Origin: `${r.origin}/` }, { Origin: r.origin, 'Sec-Fetch-Site': 'cross-site' }]) {
      const denied = await fetch(`${r.origin}/auth/confirm`, {
        method: 'POST', redirect: 'manual', headers,
        body: new URLSearchParams({ token: link.searchParams.get('token') }),
      });
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { error: 'invalid_origin' });
      assert.deepEqual(await state(r.db), before);
    }
    await page.goto(link.href);
    assert.equal((await clickConfirm(page)).status(), 303, 'denied attempts must leave the link usable');
  } finally {
    await browser?.close();
    if (attacker.listening) await new Promise((resolve) => attacker.close(resolve));
    await r.close();
  }
});

test('confirmation document sends at most an origin to same-origin and cross-origin navigations', async () => {
  const r = await browserRuntime();
  let browser;
  const receiver = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ referer: request.headers.referer ?? null }));
  });
  try {
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const link = await r.issue();
    const before = await state(r.db);
    for (const destination of [`${r.origin}/probe`, `http://127.0.0.1:${receiver.address().port}/probe`]) {
      await page.goto(link.href);
      // Add only a test navigation control; keep the server-supplied document
      // policy intact so Chromium computes Referer from the token-bearing URL.
      await page.evaluate((href) => {
        const anchor = document.createElement('a');
        anchor.href = href; anchor.textContent = 'Privacy probe'; document.body.append(anchor);
      }, destination);
      const sent = page.waitForRequest(destination);
      const received = page.waitForResponse(destination);
      await page.getByRole('link', { name: 'Privacy probe' }).click();
      const headers = await (await sent).allHeaders();
      assert.equal(headers.referer, `${r.origin}/`);
      assert.ok(!headers.referer.includes(link.searchParams.get('token')));
      const response = await received;
      if (new URL(destination).origin !== r.origin) {
        assert.deepEqual(await response.json(), { referer: `${r.origin}/` }, 'receiver must observe only the origin');
      }
    }
    assert.deepEqual(await state(r.db), before);
    for (const path of ['/auth/session', '/auth/missing', '/auth/confirm?token=invalid']) {
      assertHeaders((await fetch(`${r.origin}${path}`)).headers, 'no-referrer', path.startsWith('/auth/confirm'));
    }
  } finally {
    await browser?.close();
    if (receiver.listening) await new Promise((resolve) => receiver.close(resolve));
    await r.close();
  }
});
