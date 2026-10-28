import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { decorateLabel } from '../label.mjs';

const require = createRequire(new URL('../../../default-seed/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

async function door(run: (page: any, origin: string) => Promise<void>) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    if (url.pathname === '/run') { response.end('Run destination'); return; }
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>
      body{margin:0;font:16px sans-serif}header{display:flex;align-items:center;gap:1rem;padding:1rem}
      header.grid{display:grid;grid-template-columns:max-content 1fr max-content}
      nav{margin-inline-start:auto}button{flex:none}a{color:inherit}
      header.empty{width:max-content;gap:0;padding:0}header.empty nav{display:none}
    </style></head><body><header class="${url.searchParams.get('shape') ?? ''}"><a href="/app" data-rer-name>Atlas</a><nav>Projects</nav><button>Owner</button></header></body></html>`;
    const decorated = await decorateLabel(new Response(html, { headers: { 'content-type': 'text/html' } }), 'Demo', url.searchParams.has('noexit') ? null : { name: url.searchParams.get('name') ?? 'Atlas', url: '/run' });
    response.writeHead(decorated.status, Object.fromEntries(decorated.headers));
    response.end(await decorated.text());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await run(await browser.newPage(), `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const settled = async (page: any) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));

test('demo exit preserves narrow host geometry through the decorated HTTP door', async () => {
  await door(async (page, origin) => {
    for (const shape of ['', 'grid', 'empty']) for (const width of [1440, 1280, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 600 });
      const geometry = () => page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        siblings: [...document.querySelector('header')!.children].filter(element => !element.hasAttribute('data-rer-demo-exit')).map(element => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        }),
      }));
      await page.goto(`${origin}/?shape=${shape}&noexit`);
      await settled(page);
      const absent = await geometry();
      await page.goto(`${origin}/?shape=${shape}&name=${'A'.repeat(40)}`);
      await page.locator('[data-rer-demo-exit]').waitFor({ state: 'attached' });
      await settled(page);
      assert.deepEqual(await geometry(), absent, 'the exit gives up its own room without moving or resizing the host');
    }
  });
});

test('constrained exit keeps its full accessible name and keyboard destination', async () => {
  await door(async (page, origin) => {
    const name = 'A'.repeat(40);
    await page.goto(`${origin}/?shape=empty&name=${name}`);
    const exit = page.locator('[data-rer-demo-exit]');
    await exit.waitFor({ state: 'attached' });
    await settled(page);
    const full = await exit.textContent();
    assert.ok(full?.includes(name));
    assert.equal(await exit.getAttribute('title'), full);
    assert.equal(await page.getByRole('link', { name: full!, exact: true }).count(), 1);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await exit.evaluate((element: Element) => element === document.activeElement), true);
    assert.equal(await exit.evaluate((element: Element) => element.matches(':popover-open')), true);
    assert.ok(await exit.isVisible());
    await page.keyboard.press('Enter');
    await page.waitForURL(`${origin}/run`);
  });
});
