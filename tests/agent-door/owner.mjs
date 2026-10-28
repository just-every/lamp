import assert from 'node:assert/strict';
import { prepareNativeFixtures } from './owner-fixtures.mjs';
import { nativeFixture } from './fixture-state.mjs';

/** Drive Lamp's production first-owner lifecycle; no fixture SQL or alternate auth. */
export default async function initializeOwner({ request, origin, token, displayName, email, mail, reviewers }) {
  const bootstrap = await request(new URL('/auth/bootstrap', origin).href, {
    method: 'POST', redirect: 'manual',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, displayName, returnTo: '/setup' }),
  });
  assert.equal(bootstrap.status, 303, 'Native owner claim must create a normal person session');
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
  const reviewer = await reviewers.initialize('independent', { cookie });
  const created = await request(new URL('/api/app/incidents', origin).href, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Independent native review', components: [{ componentId: nativeFixture().componentId, state: 'Degraded performance', relationship: 'Primary' }],
      update: { lifecycle: 'Investigating', affectedAudience: 'API customers', customerImpact: 'Some requests fail.', whatStillWorks: 'The dashboard works.', details: 'Native review evidence.', nextUpdateAt: null } }),
  });
  assert.equal(created.status, 201);
  const { incident } = await created.json();
  const version = `${incident.draft.id}:${incident.updates.length}`;
  const review = who => request(new URL(`/api/app/incidents/${incident.id}/draft/review`, origin).href, {
    method: 'POST', headers: { Origin: origin, Cookie: who, 'If-Match': version },
  });
  const ownReview = await review(cookie);
  assert.equal(ownReview.status, 409, 'The author cannot be their own independent reviewer');
  await ownReview.body?.cancel();
  const independent = await review(reviewer.cookie);
  assert.equal(independent.status, 200, 'A separately confirmed native person reviews the exact draft');
  await independent.body?.cancel();
  const reviewed = await read(`/api/app/incidents/${incident.id}`);
  const session = await request(new URL('/api/app/session', origin).href, { headers: { Cookie: reviewer.cookie } });
  const reviewerPerson = (await session.json()).operator;
  assert.equal(reviewed.incident.draft.reviewedByOperatorId, reviewerPerson.id, 'Native review names the actual person');
  assert.notEqual(reviewerPerson.id, operator.id);
  return bootstrap;
}
