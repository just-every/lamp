import assert from 'node:assert/strict';
import { prepareNativeFixtures } from './owner-fixtures.mjs';

/** Drive Lamp's production first-owner lifecycle; no fixture SQL or alternate auth. */
async function initializeOwner({ request, origin, token, displayName, email, mail, reviewers }) {
  const bootstrap = await request(new URL('/auth/bootstrap', origin).href, {
    method: 'POST', redirect: 'manual',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, displayName, returnTo: '/setup' }),
  });
  const refused = bootstrap.status === 303 ? null : await bootstrap.clone().json().catch(() => null);
  const code = typeof refused?.error === 'string' && /^[a-z_]+$/.test(refused.error) ? refused.error : 'unavailable';
  assert.equal(bootstrap.status, 303, 'Native owner claim must create a normal person session (HTTP ' + bootstrap.status + ', ' + code + ')');
  const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  assert.ok(cookie, 'Native owner claim must retain its session cookie');
  const read = async path => {
    const response = await request(new URL(path, origin).href, { headers: { Origin: origin, Cookie: cookie } });
    assert.equal(response.status, 200, `Native owner read ${path}`);
    return response.json();
  };
  const { operator } = await read('/api/app/session');
  assert.ok(operator?.id, 'The session must resolve the real native operator');
  const page = await request(new URL('/api/app/page-settings', origin).href, { headers: { Origin: origin, Cookie: cookie } });
  if (page.status === 404) {
    await page.body?.cancel();
    const created = await request(new URL('/api/app/page-settings', origin).href, {method: 'POST', headers: {Origin: origin, Cookie: cookie, 'Content-Type': 'application/json'}, body: JSON.stringify({pageName: 'Conformance status', tagline: 'Native incident communication', accentColor: '#163c60', timezone: 'UTC', hostname: 'status.rer-hosted-check.invalid', footerCreditEnabled: true})});
    assert.equal(created.status, 201, 'Native owner initializes the page through the production setup route');
    await created.body?.cancel();
  } else { assert.equal(page.status, 200); await page.body?.cancel(); }
  const { settings } = await read('/api/app/page-settings');
  assert.ok(settings?.pageName, 'The production owner lifecycle must initialize page settings');
  const complete = await request(new URL('/api/app/overview/first-run', origin).href, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ components: ['Conformance API', 'Conformance dashboard'] }),
  });
  assert.equal(complete.status, 200, 'First-run uses the ordinary native component lifecycle');
  await complete.body?.cancel();
  await prepareNativeFixtures({ request, origin, cookie, email, token, mail });
  const reviewer = await reviewers.initialize('independent', {cookie});
  const {nativeFixture} = await import('./fixture-state.mjs');
  nativeFixture().reviewer = reviewer;
  return bootstrap;
}

export default async function owner(args) {
  try { return await initializeOwner(args); }
  catch (error) {
    if (error instanceof assert.AssertionError) console.error('Lamp native owner fixture: ' + error.message.split('\n')[0]);
    throw error;
  }
}
