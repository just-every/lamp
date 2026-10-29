import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, serialize } from 'parse5';
import { eventually } from './status-journey.mjs';

function sections(html, className) {
  const found = [];
  const visit = node => {
    if (node.attrs?.some(attr => attr.name === 'class' && attr.value.split(/\s+/).includes(className))) found.push(serialize(node));
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html));
  return found;
}

// Extend the existing catalogue journey: deletion must invalidate warm public
// resources while leaving independently published communication intact.
export async function publicComponentDeletion(j, { component, incident, browser }) {
  const name = (await j.json('/api/app/components')).components.find(row => row.id === component.id).name;
  assert.equal(name, component.name);
  const retained = await j.component('Synthetic Lamp retained service');
  const now = Date.now();
  const maintenance = (await j.json('/api/app/maintenance', 'POST', {
    title: 'Synthetic Lamp component retirement preparation',
    affectedAudience: 'Customers using the retiring service',
    customerImpact: 'Requests continue during retirement preparation.',
    startsAt: new Date(now + 3600000).toISOString(), endsAt: new Date(now + 7200000).toISOString(),
    componentIds: [component.id], autoStart: false, autoComplete: false,
  }, 201)).maintenance;
  await j.json(`/api/app/maintenance/${maintenance.id}/start`, 'POST', {});
  await j.json(`/api/app/maintenance/${maintenance.id}/complete`, 'POST', {});
  await j.visible('/history', maintenance.title);

  const read = async path => {
    const response = await j.publicResponse(path);
    return { path, status: response.status, version: response.headers.get('x-lamp-snapshot-version'), stale: response.headers.get('x-lamp-snapshot-state'), body: await response.text() };
  };
  const collection = async name => {
    const responses = [], data = [];
    let cursor;
    do {
      const response = await read(`/api/public/v1/${name}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(response.status, 200, response.path);
      responses.push(response);
      const page = JSON.parse(response.body);
      data.push(...page.data);
      assert.notEqual(page.nextCursor, cursor, 'public pagination advances');
      cursor = page.nextCursor;
    } while (cursor);
    return { responses, data };
  };
  await eventually(() => collection('maintenance'), value => value.data.some(row => row.id === maintenance.id && row.state === 'Completed'), 'completed maintenance is published before deletion');
  const beforeComponents = await collection('components');
  const published = beforeComponents.data.find(row => row.id === component.id);
  assert.equal(published.name, name);
  assert.ok(published.uptime.marks.some(mark => mark.downtimeMinutes > 0), 'the deleted component has a populated public daily record');
  const incidentBefore = (await collection('incidents')).data.find(row => row.id === incident.id);
  const maintenanceBefore = (await collection('maintenance')).data.find(row => row.id === maintenance.id);
  assert.deepEqual(incidentBefore.components, [name]);
  assert.deepEqual(maintenanceBefore.components, [name]);
  assert.ok(maintenanceBefore.notices.some(row => row.kind === 'completed'));
  const resources = ['feed.atom', 'feed.rss', 'badge.svg', 'uptime.svg'].map(resource => `/components/${published.slug}/${resource}`);
  const rootBefore = await read('/');
  assert.ok(sections(rootBefore.body, 'component-health').some(body => body.includes(name)));
  for (const path of resources) {
    const response = await read(path);
    assert.equal(response.status, 200, `prewarm ${path}`);
    assert.ok(response.body.includes(path.endsWith('/uptime.svg') ? published.uptime.percentage : name), `populated ${path}`);
  }
  const documentPaths = ['/', '/history', `/incidents/${incident.reference}`, `/maintenance/${maintenance.reference}`, '/api/v2/components.json'];
  for (const path of documentPaths) assert.equal((await read(path)).status, 200, `prewarm ${path}`);

  const privateBefore = await j.json('/api/app/components');
  const refused = await j.raw(`/api/app/components/${component.id}`, { method: 'DELETE', headers: { Origin: j.appOrigin } });
  assert.equal(refused.status, 401, 'an unauthenticated deletion is refused');
  await refused.arrayBuffer();
  assert.deepEqual(await j.json('/api/app/components'), privateBefore, 'a refused deletion leaves the complete catalogue unchanged');
  assert.equal((await read('/')).body, rootBefore.body, 'a refused deletion leaves the published page unchanged');

  await j.json(`/api/app/components/${component.id}`, 'DELETE', undefined, 204);
  const deletedAt = performance.now();
  const deadline = deletedAt + 10000;
  let observed, reconciled = false;
  do {
    const [documents, componentResources, components, incidents, windows, health] = await Promise.all([
      Promise.all(documentPaths.map(read)), Promise.all(resources.map(read)),
      collection('components'), collection('incidents'), collection('maintenance'), j.request('/health'),
    ]);
    await health.arrayBuffer();
    const root = documents[0];
    const snapshots = [...documents, ...components.responses, ...incidents.responses, ...windows.responses];
    const catalogue = ['component-health', 'subscribe', 'footer-resources'].flatMap(className => sections(root.body, className));
    observed = { documents, componentResources, components, incidents, windows, health: health.status, elapsed: performance.now() - deletedAt };
    if (health.status === 200 && root.version && root.version !== rootBefore.version &&
        snapshots.every(row => row.status === 200 && row.version === root.version && row.stale === null) &&
        componentResources.every(row => row.status === 404) &&
        !components.data.some(row => row.id === component.id) &&
        !JSON.parse(documents[4].body).components.some(row => row.name === name) &&
        catalogue.length > 0 && catalogue.every(body => !body.includes(name) && !body.includes(component.id))) {
      reconciled = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
  assert.ok(reconciled && observed.elapsed <= 10000, `component state and uptime disappear in one ten-second deadline: ${JSON.stringify(observed)}`);
  assert.equal(observed.health, 200);
  assert.notEqual(observed.documents[0].version, rootBefore.version);
  assert.ok(observed.componentResources.every(row => row.status === 404), 'warm component feeds and state and uptime badges are gone');
  assert.ok(!observed.components.data.some(row => row.id === component.id), 'the complete public component inventory and daily uptime omit the deleted component');
  assert.deepEqual(observed.components.data.map(row => row.id).sort(), beforeComponents.data.filter(row => row.id !== component.id).map(row => row.id).sort(), 'deletion preserves every other public component');
  const privateAfter = await j.json('/api/app/components');
  assert.deepEqual(privateAfter, { ...privateBefore, components: privateBefore.components.filter(row => row.id !== component.id) }, 'only the requested component leaves the operator catalogue');
  await j.json(`/api/app/components/${component.id}/history`, 'GET', undefined, 404);
  const incidentAfter = observed.incidents.data.find(row => row.id === incident.id);
  const maintenanceAfter = observed.windows.data.find(row => row.id === maintenance.id);
  assert.deepEqual(incidentAfter.components, [name]);
  assert.deepEqual(incidentAfter.updates, incidentBefore.updates, 'published incident updates survive deletion unchanged');
  assert.deepEqual(maintenanceAfter.components, [name]);
  assert.deepEqual(maintenanceAfter.notices, maintenanceBefore.notices, 'published maintenance notices survive deletion unchanged');
  for (const [index, className, title] of [[1, 'history-item', incident.title], [1, 'history-item', maintenance.title], [2, 'incident', incident.title], [3, 'maintenance', maintenance.title]]) {
    const records = sections(observed.documents[index].body, className).filter(body => body.includes(title));
    assert.equal(records.length, 1, title);
    assert.ok(records[0].includes(name), `${title} retains its independently captured component name`);
  }
  console.log(`COMP-007 deletion receipt: ${JSON.stringify({ elapsedMs: observed.elapsed, before: rootBefore.version, after: observed.documents[0].version, resources: observed.componentResources.map(row => ({ path: row.path, status: row.status })) })}`);

  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(j.publicOrigin);
    const catalogueText = (await page.locator('.component-health').allTextContents()).join('\n');
    assert.ok(!catalogueText.includes(name));
    assert.ok(catalogueText.includes(retained.name), 'the remaining public catalogue stays visible');
    if (process.env.LAMP_BROWSER_PROOF_DIRECTORY) {
      await mkdir(process.env.LAMP_BROWSER_PROOF_DIRECTORY, { recursive: true });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [label, path] of [['catalogue', '/'], ['history', '/history'], ['maintenance', `/maintenance/${maintenance.reference}`]]) {
          await page.goto(j.publicOrigin + path);
          await page.screenshot({ path: join(process.env.LAMP_BROWSER_PROOF_DIRECTORY, `comp007-${label}-${width}.png`), fullPage: true });
        }
      }
    }
  } finally { await context.close(); }
}
