// The shared sign-in page in real Chromium with JavaScript disabled (so it works
// before any hydration), at 1440 and 390, light and dark: the providers, the
// email link, a provider sign-in, and a hidden provider. axe serious and
// critical findings must be zero on every state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserRuntime, runtime, presets } from '../../identity/oidc/tests/fake-runtime.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const { chromium } = createRequire(join(root, 'default-seed/package.json'))('@playwright/test');
const axe = await readFile(new URL('../../tests/vendor/axe-core/axe.min.js', import.meta.url), 'utf8');
const captures = process.env.SIGNIN_CAPTURE_DIR;
const buttons = async page => page.getByRole('button', { name: /^Continue with / }).allTextContents();

for (const colorScheme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`sign-in journeys before hydration at ${width}, ${colorScheme}`, async t => {
    const r = await browserRuntime(t, origin => ({ ...presets(origin), core: { origin, local: true }, }));
    assert.equal((await r.post('/auth/bootstrap', { token: 'test-only-fake-provider-setup-token-value', displayName: 'Owner' })).status, 303);
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, javaScriptEnabled: false });
    const page = await context.newPage();
    // axe needs timers, which a script-disabled page never runs. The audited
    // pages carry no script at all, so the same URL renders identically in a
    // script-enabled page with the same cookies and colour scheme.
    const auditor = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
    const audited = [];
    async function audit(name) {
      assert.equal(await page.locator('script').count(), 0, `${name}: no script on the page`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: no horizontal scroll`);
      await auditor.clearCookies(); await auditor.addCookies(await context.cookies());
      const view = await auditor.newPage();
      try {
        await view.goto(page.url());
        await view.evaluate(axe);
        const severe = await view.evaluate(async () => (await axe.run(document)).violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => ({ id: v.id, impact: v.impact })));
        assert.deepEqual(severe, [], `${name}: axe serious/critical`);
      } finally { await view.close(); }
      if (captures) { await mkdir(captures, { recursive: true }); await page.screenshot({ path: join(captures, `${width}-${colorScheme}-${name}.png`), fullPage: true }); }
      audited.push(name);
    }
    const signedInAs = async () => {
      const cookies = (await context.cookies()).filter(c => c.name === `operator_session_local_${new URL(r.origin).port}`).map(c => `${c.name}=${c.value}`).join('; ');
      const response = await fetch(`${r.origin}/test/private`, { headers: { Cookie: cookies } });
      return response.status === 200 ? (await response.json()) : null;
    };

    await page.goto(`${r.origin}/signin?returnTo=/app/queue`);
    await page.getByRole('heading', { name: 'Sign in to Fixture' }).waitFor();
    assert.deepEqual(await buttons(page), ['Continue with Auth', 'Continue with Google', 'Continue with Microsoft', 'Continue with Okta']);
    await audit('providers');

    // The email link, with plain form posts only.
    await page.getByLabel('Email', { exact: true }).fill('owner@example.com');
    await page.getByRole('button', { name: 'Email a sign-in link' }).click();
    await page.getByRole('status').filter({ hasText: 'If this address can sign in here' }).waitFor();
    assert.match(page.url(), /notice=sent/);
    await audit('link-sent');
    await page.goto((await r.link()).href);
    await page.getByRole('heading', { name: 'Confirm sign-in to Fixture' }).waitFor();
    await audit('confirm');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/app/queue');
    assert.equal((await signedInAs())?.kind, 'native');
    await context.clearCookies();

    // A provider sign-in: the button posts to the app, which sends the browser to
    // the provider (the page's form-action must allow that hop). The provider is
    // not reachable from a test browser, so the test plays it: it grants the
    // request the browser was sent with and navigates back to the redirect URI.
    await page.goto(`${r.origin}/signin?returnTo=/app`);
    const sent = page.waitForEvent('requestfailed', request => request.url().startsWith('https://id.example/authorize?'));
    await page.getByRole('button', { name: 'Continue with Auth' }).click();
    const authorization = (await sent).url();
    const { code, state } = await (await r.post('/__fake/authorize', { location: authorization, claims: {} })).json();
    // The same browser (and its binding cookie from the app's redirect) returns to the redirect URI.
    const back = await context.newPage();
    await back.goto(`${new URL(authorization).searchParams.get('redirect_uri')}?code=${code}&state=${state}`);
    assert.equal(new URL(back.url()).pathname, '/app');
    await back.close();
    assert.deepEqual([(await signedInAs())?.kind, (await signedInAs())?.email], ['oidc', 'owner@example.com']);
    await context.clearCookies();

    // A provider whose name no longer resolves is hidden; the email link stays.
    await r.set('https://corp.okta.example', { failure: 'dns' });
    await fetch(`${r.origin}/auth/oidc/okta/start`, { method: 'POST', redirect: 'manual', headers: { Origin: r.origin, 'Content-Type': 'application/json' }, body: '{}' });
    await page.goto(`${r.origin}/signin`);
    assert.deepEqual(await buttons(page), ['Continue with Auth', 'Continue with Google', 'Continue with Microsoft']);
    assert.equal(await page.getByRole('button', { name: 'Email a sign-in link' }).count(), 1);
    await audit('provider-hidden');
    await page.goto(`${r.origin}/signin?notice=oidc_provider_unavailable`);
    await page.getByRole('alert').filter({ hasText: 'not available right now' }).waitFor();
    await audit('provider-unavailable');
    assert.equal(audited.length, 5);
  });
}

// A provider-only composition must offer the working route, without an email
// form whose submission is guaranteed to fail at the absent transport.
test('provider sign-in remains usable without a mail sender', async t => {
  const r = await runtime(t, { ...presets(), noMail: true });
  await r.bootstrap();
  const response = await r.call('/signin?returnTo=/app/queue');
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /action="\/auth\/oidc\/auth\/start"/);
  assert.doesNotMatch(html, /action="\/auth\/magic-link"|class="divider"/);
  const signedIn = await r.login('auth');
  assert.equal(signedIn.status, 303);
  assert.ok(r.session(signedIn));
  assert.deepEqual(await r.mails(), []);
});
