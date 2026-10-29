import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

/** Inspect the same fresh production Worker already owned by rer verify. */
export async function inspectNativePages({ request, origin, cookie }) {
  const person = async (path, method = 'GET', body) => {
    const response = await request(new URL(path, origin).href, { method,
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `Native page fixture ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const { approvals } = await person('/agents/api/approvals');
  const pending = approvals.find(item => item.state === 'pending');
  const executed = approvals.find(item => item.state === 'executed');
  assert.ok(pending && executed, 'The real held-policy journey supplies pending and executed approvals');
  const { incidents } = await person('/api/app/incidents');
  const incident = incidents.find(item => item.updates?.length || item.updateCount > 0);
  assert.ok(incident, 'The real autonomous journey supplies a published incident');
  const browser = await chromium.launch({ headless: true });
  let paused = false;
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies(cookie.split('; ').map(part => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: origin, secure: true, httpOnly: true };
    }));
    await context.route('**/*', async route => {
      const input = route.request(), url = new URL(input.url());
      if (url.origin !== origin) return route.abort();
      const response = await request(url.href, { method: input.method(), headers: await input.allHeaders(),
        ...(input.postDataBuffer() ? { body: input.postDataBuffer() } : {}),
      });
      const headers = Object.fromEntries(response.headers);
      delete headers['content-length']; delete headers['content-encoding'];
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    const capture = async (label, width) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze())
        .violations.filter(item => ['serious', 'critical'].includes(item.impact));
      const smallControls = await page.locator('form[data-approval-action] button, form[data-agents-pause] button').evaluateAll(buttons =>
        buttons.filter(button => { const box = button.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44); }).map(button => button.textContent));
      console.log(`PAGE_CHECK ${JSON.stringify({ label, width, overflow, serious: serious.map(item => item.id), smallControls })}`);
      if (!process.env.GITHUB_ACTIONS) console.log(`PAGE_IMAGE ${label}-${width} ${(await page.screenshot({ fullPage: !label.startsWith('agents-') })).toString('base64')}`);
      assert.equal(overflow, false, `${label}: horizontal overflow`);
      assert.deepEqual(serious.map(item => item.id), [], `${label}: serious or critical accessibility findings`);
      assert.deepEqual(smallControls, [], `${label}: controls need a 44px target`);
    };
    const view = async (label, path, width) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(new URL(path, origin).href, { waitUntil: 'networkidle' });
      await capture(label, width);
    };
    for (const width of [1440, 390]) {
      await view('agents-pending', '/agents', width);
      await view('approval-pending', `/agents/approvals/${pending.id}`, width);
      const evidence = page.locator('form[data-approval-action="approve"] input[name="revision"]');
      assert.equal(await evidence.count(), 1);
      await evidence.evaluate(input => { input.value = '-1'; });
      await page.getByRole('button', { name: 'Approve', exact: true }).click();
      await page.locator('#action-status').filter({ hasText: /changed|Unable to save/ }).waitFor();
      await capture('approval-error', width);
      await view('approval-executed', `/agents/approvals/${executed.id}`, width);
      await view('incident-published', `/app/incidents/${incident.id}`, width);
      await view('agent-guide', '/docs/agents', width);
      await view('native-proof-guide', '/docs/agent-native-proof', width);
    }
    await person('/agents/api/pause', 'POST', { paused: true }); paused = true;
    for (const width of [1440, 390]) await view('agents-blocked', '/agents', width);
    await context.close();
  } finally {
    if (paused) await person('/agents/api/pause', 'POST', { paused: false });
    await browser.close();
  }
}
