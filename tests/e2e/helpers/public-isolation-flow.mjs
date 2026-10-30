import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Install before any page script. Observe calls without suppressing their real
// effects; the independent store inventories also catch uninstrumented writes.
function observeVisitorStorage() {
  const record = api => { void globalThis.__recordVisitorWrite(api); };
  const wrap = (prototype, names, prefix) => {
    for (const name of names) {
      const original = prototype[name];
      prototype[name] = function (...args) {
        record(`${prefix}.${name}`);
        return Reflect.apply(original, this, args);
      };
    }
  };
  wrap(Storage.prototype, ['setItem', 'removeItem', 'clear'], 'Storage');
  for (const name of ['localStorage', 'sessionStorage']) {
    const storage = globalThis[name];
    const proxy = new Proxy(storage, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { record(`${name}.property`); return Reflect.set(target, key, value, target); },
      defineProperty(target, key, descriptor) { record(`${name}.defineProperty`); return Reflect.defineProperty(target, key, descriptor); },
      deleteProperty(target, key) { record(`${name}.deleteProperty`); return Reflect.deleteProperty(target, key); },
    });
    Object.defineProperty(globalThis, name, { configurable: true, get: () => proxy });
  }
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  Object.defineProperty(Document.prototype, 'cookie', {
    ...cookie,
    set(value) { record('document.cookie'); return cookie.set.call(this, value); },
  });
  wrap(IDBFactory.prototype, ['open', 'deleteDatabase'], 'indexedDB');
  wrap(IDBDatabase.prototype, ['createObjectStore', 'deleteObjectStore'], 'IDBDatabase');
  wrap(IDBObjectStore.prototype, ['add', 'put', 'delete', 'clear'], 'IDBObjectStore');
  wrap(CacheStorage.prototype, ['open', 'delete'], 'CacheStorage');
  wrap(Cache.prototype, ['add', 'addAll', 'put', 'delete'], 'Cache');
}

async function assertAnonymousPage(context, page, writes, responses, description) {
  // Waiting for this binding flushes the observations into the test process;
  // that process retains writes even when a script removes data or reloads.
  await page.evaluate(() => globalThis.__recordVisitorWrite(null));
  assert.deepEqual(writes, [], `${description}: no visitor storage write was attempted`);
  for (const headers of await Promise.all(responses.splice(0))) {
    assert.equal(headers['set-cookie'], undefined, `${description}: public responses set no cookie`);
  }
  assert.deepEqual(await context.cookies(), [], `${description}: the anonymous cookie jar stays empty`);
  const inventory = await page.evaluate(async () => ({
    cookie: document.cookie,
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    databases: await indexedDB.databases(),
    caches: await caches.keys(),
  }));
  assert.deepEqual(inventory, { cookie: '', local: [], session: [], databases: [], caches: [] }, `${description}: every browser store is independently empty`);
  assert.equal(await page.locator('[id*="captcha" i], [class*="captcha" i], [name*="captcha" i], [src*="captcha" i], [data-sitekey]').count(), 0, `${description}: no CAPTCHA control or provider frame`);
  assert.equal(await page.locator('[id*="consent" i], [class*="consent" i], [id*="cookie" i], [class*="cookie" i]').count(), 0, `${description}: no consent banner control`);
  assert.doesNotMatch(await page.locator('body').innerText(), /\bcaptcha\b|\b(?:cookie|consent) (?:banner|preferences|settings)\b|\b(?:accept|reject|allow) (?:all )?cookies\b/i, `${description}: no CAPTCHA or consent prompt in the populated page`);
}

/** A real anonymous reader follows every shipped layout across publication. */
export async function publicIsolationFlow(j, browser) {
  const saved = (await j.json('/api/app/page-settings')).settings;
  const settings = Object.fromEntries(['pageName', 'tagline', 'accentColor', 'timezone', 'hostname', 'footerCreditEnabled', 'mailFromAddress', 'widgetAllowedOrigins'].map(key => [key, saved[key]]));
  const primary = await j.component('Synthetic Lamp anonymous API', { region: 'Europe' });
  const secondary = await j.component('Synthetic Lamp anonymous dashboard', { region: 'North America' });
  const incident = await j.incident('Synthetic Lamp populated privacy incident', [primary, secondary]);
  let impact = 'Synthetic Lamp initial customer impact';
  await j.save(incident.id, { customerImpact: impact });
  await j.publish(incident.id);
  try {
    for (const template of ['default', 'calm', 'uptime', 'regions']) {
      await j.json('/api/app/page-settings', 'PUT', { ...settings, template });
      await j.visible('/', impact);
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const writes = [], responses = [];
      try {
        await context.exposeBinding('__recordVisitorWrite', (_source, api) => { if (api !== null) writes.push(api); });
        await context.addInitScript(observeVisitorStorage);
        const page = await context.newPage();
        page.on('response', response => responses.push(response.allHeaders()));
        await page.clock.install();
        assert.deepEqual(await context.cookies(), [], `${template}: a fresh reader has no operator cookie`);
        assert.equal((await page.goto(j.publicOrigin, { waitUntil: 'networkidle' })).status(), 200);
        assert.equal(await page.locator('body').getAttribute('data-template'), template === 'default' ? null : template, 'Regions map must run as Regions map rather than its fallback');
        assert.ok((await page.locator('body').innerText()).includes(primary.name));
        assert.ok((await page.locator('body').innerText()).includes(impact), 'the privacy check observes a populated incident');
        await assertAnonymousPage(context, page, writes, responses, `${template} initial load`);
        const poll = async () => {
          const response = page.waitForResponse(item => new URL(item.url()).pathname === '/api/public/status' && item.status() === 200);
          await page.clock.fastForward(30000);
          await response;
        };
        await poll();
        await assertAnonymousPage(context, page, writes, responses, `${template} unchanged poll`);
        impact = `Synthetic Lamp ${template} newly published customer impact`;
        await j.save(incident.id, { customerImpact: impact });
        await j.publish(incident.id);
        await j.visible('/', impact);
        await poll();
        await page.waitForFunction(text => document.body.innerText.includes(text), impact);
        await assertAnonymousPage(context, page, writes, responses, `${template} published refresh`);
        assert.equal((await page.reload({ waitUntil: 'networkidle' })).status(), 200);
        assert.ok((await page.locator('body').innerText()).includes(impact));
        await assertAnonymousPage(context, page, writes, responses, `${template} reload`);
        if (process.env.LAMP_SCREENSHOTS) {
          await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
          for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
            await page.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-isolation-${template}.png`, fullPage: true });
          }
        }
        console.info(`PROBE PAGE-013 acceptance2 ${template}: anonymous populated root, poll, native publication, reload -> no CAPTCHA or consent banner`);
        console.info(`PROBE PAGE-013 acceptance3 ${template}: instrumented anonymous root, poll, native publication, reload -> no writes; cookies, localStorage, sessionStorage, IndexedDB and CacheStorage empty`);
      } finally { await context.close(); }
    }
  } finally {
    await j.save(incident.id, { lifecycle: 'Resolved', customerImpact: 'Synthetic Lamp privacy journey complete', nextUpdateAt: null });
    await j.publish(incident.id);
    await j.json('/api/app/page-settings', 'PUT', { ...settings, template: saved.template });
    await j.json(`/api/app/components/${primary.id}`, 'DELETE', undefined, 204);
    await j.json(`/api/app/components/${secondary.id}`, 'DELETE', undefined, 204);
  }
}
