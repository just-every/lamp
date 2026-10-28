import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { decorateLabel } from '../label.mjs';

const require = createRequire(new URL('../../../default-seed/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

test('demo decoration keeps singular titles and its run exit through client navigation', async () => {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    const title = url.searchParams.has('title') ? `<title>${url.searchParams.get('title')}</title>` : '';
    const decorated = await decorateLabel(new Response(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width">${title}</head><body><nav><a href="/app" data-rer-name>Workspace</a></nav></body></html>`, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'none'; style-src 'none'" },
    }), url.searchParams.get('mode'), { name: url.searchParams.get('name') ?? 'Example', url: 'https://run-example.test/run' });
    response.writeHead(decorated.status, Object.fromEntries(decorated.headers));
    response.end(await decorated.text());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
    const context = await browser.newContext();
    const page = await context.newPage();
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(`${origin}/?${new URLSearchParams({mode: 'Demo', name: 'Pencil'})}`);
    await page.locator('[data-rer-demo-exit]').waitFor();
    if (process.env.RER_TEST_EVIDENCE_DIRECTORY) await page.screenshot({path: `${process.env.RER_TEST_EVIDENCE_DIRECTORY}/demo-${width}.png`});
    for (const name of ['Revenue $&', "Revenue $'", 'Revenue $`', 'Revenue $$', '<img src=x onerror="window.__G16=1">', 'Revenue "quoted"', "Revenue 'quoted'", '収益 café 🧭']) {
      await page.goto(`${origin}/?${new URLSearchParams({ mode: 'Demo', name })}`);
      const exits = page.locator('[data-rer-demo-exit]');
      await exits.waitFor();
      assert.equal(await exits.count(), 1);
      assert.ok((await exits.textContent())?.endsWith(name), 'accepted product names remain literal text');
      assert.equal(await exits.getAttribute('href'), 'https://run-example.test/run');
      assert.equal(await page.locator('style[data-rer-label]').getAttribute('data-rer-product'), name);
      assert.equal(await page.locator('img, [onerror]').count(), 0, 'names cannot create markup or event handlers');
      assert.equal(await page.evaluate(() => (window as any).__G16), undefined);
    }
    const cases: [string | null, string][] = [[null, ''], ['', ''], ['Demo', ''], ['Dev', ''], [' Demo', ''], ['\tDev', ''], ['Workspace', 'Workspace'], ['Workspace\tDemo', 'Workspace'], ['Workspace\nDev', 'Workspace']];
    for (const mode of ['Demo', 'Dev']) {
      for (const [input, base] of cases) {
        const expected = base ? `${base} ${mode}` : mode;
        const params = new URLSearchParams({ mode });
        if (input !== null) params.set('title', input);
        const url = `${origin}/?${params}`;
        const html = await (await fetch(url)).text();
        assert.equal(html.match(/<title>(.*?)<\/title>/s)?.[1], input === null ? undefined : expected, 'server title has one suffix and no empty-name separator');
        await page.goto(url);
        assert.equal(await page.title(), expected);
        const exits = page.locator('[data-rer-demo-exit]');
        if (mode === 'Demo') {
          await exits.waitFor();
          assert.equal(await exits.getAttribute('href'), 'https://run-example.test/run');
          assert.equal(await page.locator('nav > a[href="/app"]').count(), 1, 'the product navigation remains');
          await page.evaluate(() => { document.querySelector('nav')!.innerHTML = '<a href="/app" data-rer-name>Another workspace</a>'; });
          await exits.waitFor();
          assert.equal(await exits.count(), 1, 'client navigation keeps one exit per marked product label');
        } else assert.equal(await exits.count(), 0, 'ordinary dev has no demo exit');
        await page.evaluate(title => {
          if (title === null) document.querySelector('title')?.remove();
          else document.title = title;
        }, input);
        await page.waitForFunction(title => document.title === title, expected);
        // A head manager may mutate unrelated elements after setting a title.
        // Allow both the observer and another browser turn to run before checking.
        await page.evaluate(async () => {
          document.head.append(document.createElement('meta'));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        assert.equal(await page.title(), expected, 'head mutations preserve the single suffix');
      }
    }
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
