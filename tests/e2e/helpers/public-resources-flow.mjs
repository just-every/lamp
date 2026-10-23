import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const fixture = name => readFile(new URL(`../../fixtures/statuspage-public/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
const stateColors = JSON.parse(await readFile(new URL('../../../src/core/features/public-snapshot/state-colors.json', import.meta.url), 'utf8'));
const paths = ['summary','status','components','incidents','incidents/unresolved','scheduled-maintenances','scheduled-maintenances/upcoming','scheduled-maintenances/active'];
function fields(actual, example, path = '') {
  if (example === null) return;
  if (actual === null && /\.(resolved_at|monitoring_at|started_at|deliver_notifications|reminder_intervals)$/.test(path)) return;
  if (Array.isArray(example)) { assert.ok(Array.isArray(actual), path); return; }
  if (typeof example !== 'object') { assert.equal(typeof actual, typeof example, path); return; }
  assert.ok(actual && typeof actual === 'object', path);
  for (const [key, value] of Object.entries(example)) { assert.ok(key in actual, `${path}.${key} exists`); fields(actual[key], value, `${path}.${key}`); }
}

export async function publicResourcesFlow({ appFetch, pageUrl, fetch, diagnostic }) {
  diagnostic('PAGE-016 PAGE-017 PAGE-018 — compatibility APIs, identical feed events, component isolation and badges share one generation');
  const incidentExample = (await fixture('incidents')).incidents[0];
  const maintenanceExample = (await fixture('scheduled-maintenances')).scheduled_maintenances[0];
  let generation;
  for (const path of paths) {
    const response = await fetch(`${pageUrl}/api/v2/${path}.json`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    generation ??= response.headers.get('x-lamp-snapshot-version');
    assert.equal(response.headers.get('x-lamp-snapshot-version'), generation);
    const body = await response.json();
    fields(body, await fixture(path.replaceAll('/', '-')), path);
    assert.match(body.page.id, /^[a-z0-9]{12}$/);
    for (const incident of body.incidents ?? []) { fields(incident, incidentExample, path); for(const update of incident.incident_updates) fields(update, incidentExample.incident_updates[0], path); }
    for (const item of body.scheduled_maintenances ?? []) { fields(item, maintenanceExample, path); for(const update of item.incident_updates) fields(update, maintenanceExample.incident_updates[0], path); }
    assert.doesNotMatch(JSON.stringify(body), /Private history component|createdByOperatorId|authorOperatorId|internalNotes/);
  }
  const components = (await (await fetch(`${pageUrl}/api/v2/components.json`)).json()).components;
  assert.ok(components.some(component => component.name === 'Web application'));
  const all = [];
  let cursor = '';
  do {
    const response = await fetch(`${pageUrl}/api/public/v1/components${cursor ? `?cursor=${cursor}` : ''}`);
    assert.equal(response.status, 200);
    const page = await response.json(); all.push(...page.data); cursor = page.nextCursor;
  } while(cursor);
  assert.equal(all.length, components.filter(component=>!component.group).length);
  assert.equal(new Set(all.map(component => component.id)).size, all.length);
  const native = await (await fetch(`${pageUrl}/api/public/v1/incidents`)).json();
  const resolved = native.data.find(incident => incident.reference === 'INC-9000');
  assert.equal(resolved.updates[0].customerImpact, 'The service recovered.');
  assert.ok('report' in resolved);
  const [atom, rss, alias] = await Promise.all(['/feed.atom','/feed.rss','/history.rss'].map(async path => (await fetch(pageUrl + path)).text()));
  assert.equal(alias, rss);
  await mkdir("test-results/public-resources",{recursive:true});
  await Promise.all([writeFile("test-results/public-resources/feed.atom",atom),writeFile("test-results/public-resources/feed.rss",rss)]);
  const browser = await chromium.launch({ headless:true, args:['--use-mock-keychain','--password-store=basic'] });
  try {
    const context = await browser.newContext();
    await context.addInitScript({path:new URL('../../fixtures/statuspage-public/se-v2.js',import.meta.url).pathname});
    const page = await context.newPage();
    await page.goto(pageUrl + '/');
    const parsed = await page.evaluate(({atom,rss}) => {
      const parse = value => new DOMParser().parseFromString(value, 'application/xml');
      const a=parse(atom),r=parse(rss);
      return {errors:a.querySelectorAll('parsererror').length+r.querySelectorAll('parsererror').length, atom:[...a.querySelectorAll('entry > id')].map(x=>x.textContent),rss:[...r.querySelectorAll('item > guid')].map(x=>x.textContent)};
    }, {atom,rss});
    assert.equal(parsed.errors,0); assert.deepEqual(parsed.rss,parsed.atom); assert.ok(parsed.atom.length>0);
    const web = all.find(component => component.name === 'Web application');
    const api = all.find(component => component.name === 'API gateway');
    const webFeed = await (await fetch(`${pageUrl}/components/${web.slug}/feed.rss`)).text();
    const apiFeed = await (await fetch(`${pageUrl}/components/${api.slug}/feed.atom`)).text();
    assert.match(webFeed,/Resolved history incident/); assert.doesNotMatch(apiFeed,/Resolved history incident/);
    for (const path of ['/badge.svg',`/components/${web.slug}/badge.svg`,`/components/${web.slug}/uptime.svg`]) {
      const response = await fetch(pageUrl+path); assert.equal(response.status,200); const body=await response.text();
      assert.ok(Buffer.byteLength(body)<=2048); assert.match(body,/<text/); assert.equal(response.headers.get('x-lamp-snapshot-version'),generation);
    }
    const isolatedResponse = await appFetch('/api/app/components', { method: 'POST', body: JSON.stringify({ groupId: null, name: 'Badge colour probe', description: '', internal: false, displayOrder: 0, note: '' }) });
    assert.equal(isolatedResponse.status, 201);
    const isolated = (await isolatedResponse.json()).component;
    const isolatedSlug = isolated.id.toLowerCase();
    for (const [state, color] of Object.entries(stateColors)) {
      const started = Date.now();
      const changed = await appFetch(`/api/app/components/${isolated.id}/standing-claim`, { method: 'PUT', body: JSON.stringify({ state }) });
      assert.equal(changed.status, 200);
      await page.reload();
      const pageColor = await page.evaluate(state => {
        const pill = document.createElement('span');
        pill.className = `state-pill state-${state.toLowerCase().replaceAll(' ', '-')}`;
        document.body.append(pill);
        const value = getComputedStyle(pill, '::before').backgroundColor;
        pill.remove();
        return value;
      }, state);
      const rgb = color.match(/\w\w/g).map(value => parseInt(value, 16));
      assert.equal(pageColor, `rgb(${rgb.join(', ')})`, `${state}: badge palette matches the page's own resolved state class`);
      for (const path of [`/components/${isolatedSlug}/badge.svg`, `/components/${isolatedSlug}/uptime.svg`]) {
        const response = await fetch(pageUrl + path);
        assert.equal(response.status, 200);
        const body = await response.text();
        assert.ok(Buffer.byteLength(body) <= 2048);
        if (!path.endsWith('/uptime.svg')) assert.ok(body.includes(`>${state}</text>`), `${path}: new state label`);
        const expectedColor = body.includes('>No data</text>')
          ? await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim()) : color;
        assert.ok(body.includes(`fill="${expectedColor}"`), `${path}: page state colour, or the page's no-data ink`);
      }
      const endpoint = await (await fetch(`${pageUrl}/badge.json`)).json();
      assert.equal(endpoint.schemaVersion, 1);
      assert.equal(endpoint.color, stateColors[endpoint.message]);
      const overall = await (await fetch(`${pageUrl}/badge.svg`)).text();
      assert.ok(Buffer.byteLength(overall) <= 2048);
      assert.ok(overall.includes(`>${endpoint.message}</text>`) && overall.includes(`fill="${endpoint.color}"`));
      assert.ok(Date.now() - started < 10_000, 'each changed badge is visible within 10 seconds');
    }
    assert.equal((await appFetch(`/api/app/components/${isolated.id}`, { method: 'DELETE' })).status, 204);
    const client=await page.evaluate(()=>new Promise((resolve,reject)=>new StatusPage.page({page:'lamp',test:true}).summary({success:resolve,error:reject})));
    assert.ok(client.components.some(component=>component.name==='Web application')); assert.deepEqual(client.status,(await (await fetch(`${pageUrl}/api/v2/status.json`)).json()).status);
  } finally {await browser.close();}
}
