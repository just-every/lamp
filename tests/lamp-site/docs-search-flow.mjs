import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { buildSearchIndex } from '../../src/base/site/docs-search/index-build.mjs';

// The real rendered docs, client and query Worker. Only paid inference is fake.
export async function docsSearchFlow(browser, assets) {
  const corpus = JSON.parse(await readFile('.rer/docs-search/corpus.json', 'utf8'));
  const page = corpus.find(page => page.href === '/docs/incidents-and-updates');
  const section = page.searchSections.find(section => section.anchor === 'compose-and-publish');
  assert.ok(section, 'the published incident guide supplies the searched heading');
  const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
  const inference = async (_model, input) => ({ shape: [input.text.length, 768], data: input.text.map(() => vector) });
  const { index } = await buildSearchIndex([{ ...page, searchSections: [section] }], { embed: inference });
  const built = await build({ entryPoints: ['src/base/site/docs-search/worker.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
  const { createSearchWorker } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const worker = createSearchWorker({ corpusHash: index.corpusHash });
  let unavailable = false;
  const server = createServer(async (request, response) => {
    try {
      const result = await worker.fetch(new Request(`http://${request.headers.host}${request.url}`), {
        ASSETS: { fetch: request => new URL(request.url).pathname === '/docs-search-vectors.json'
          ? Promise.resolve(Response.json(index)) : fetch(assets + new URL(request.url).pathname) },
        AI: { run: (...args) => { if (unavailable) throw Error('test-only paid inference outage'); return inference(...args); } },
      });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { response.writeHead(500); response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        await page.goto(`${origin}/docs/first-run`);
        await page.keyboard.press('/');
        const input = page.getByRole('combobox', { name: 'Search docs' }).filter({ visible: true });
        await input.fill('publish an incident update');
        const result = page.getByRole('option').first();
        await result.waitFor();
        assert.match(await result.getAttribute('href'), /\/docs\/incidents-and-updates#compose-and-publish$/);
        await input.press('ArrowDown');
        await input.press('ArrowUp');
        await input.press('Enter');
        await page.waitForURL('**/docs/incidents-and-updates#compose-and-publish');
        assert.equal(await page.locator('#compose-and-publish').isVisible(), true);
        await page.keyboard.press('/');
        await input.press('Escape');
        assert.equal(await input.getAttribute('aria-expanded'), 'false');
        unavailable = true;
        await input.fill('provider outage');
        await page.getByRole('status').filter({ hasText: 'Search unavailable' }).waitFor();
        unavailable = false;
      } finally { await context.close(); }
    }
  } finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
}
