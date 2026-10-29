import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

/** Route browser requests to the same real production Worker used by rer verify. */
export async function withNativePageBrowser({ request, origin, cookie }, inspect) {
  const browser = await chromium.launch({ headless: true });
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
      const smallControls = await page.locator('button[data-approval-action], button[data-agents-pause], :is(.incident-page, .maintenance-workspace, .agent-deliveries-page, #audit-log) :is(button, select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), summary)').evaluateAll(buttons =>
        buttons.filter(button => { const box = button.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44); }).map(button => button.textContent));
      console.log(`PAGE_CHECK ${JSON.stringify({ label, width, overflow, serious: serious.map(item => item.id), smallControls })}`);
      if (!process.env.GITHUB_ACTIONS) console.log(`PAGE_IMAGE ${label}-${width} ${(await page.screenshot({ fullPage: !label.startsWith('agents-') })).toString('base64')}`);
      assert.equal(overflow, false, `${label}: horizontal overflow`);
      assert.deepEqual(serious.map(item => item.id), [], `${label}: serious or critical accessibility findings`);
      assert.deepEqual(smallControls, [], `${label}: controls need a 44px target`);
    };
    const view = async (label, path, width) => {
      console.log(`Native pages: opening ${label} at ${width}`);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(new URL(path, origin).href, { waitUntil: 'networkidle' });
      await capture(label, width);
    };
    await inspect({ page, capture, view });
  } finally {
    await browser.close();
  }
}
