import assert from 'node:assert/strict';

/** Native owner claim plus the production first-owner settings initializer. */
export default async function initialize({ request, origin, email, displayName, claim, returnTo }) {
  const response = await request(new URL(claim.path, origin).href, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: claim.token, displayName, returnTo }),
  });
  const refused = response.status === 303 ? null : await response.clone().json().catch(() => null);
  assert.equal(response.status, 303, `Native owner claim must create a real session (${refused?.code ?? refused?.error ?? 'no error code'})`);
  const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  assert.ok(cookie, 'Native owner session is required');
  const configured = await request(new URL('/setup', origin).href, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageName: 'Harbour service status', tagline: 'Current service and incident communication', accentColor: '#163c60', timezone: 'UTC', hostname: 'status.rer-hosted-check.invalid', footerCreditEnabled: false, mailFromAddress: 'status@rer-hosted-check.invalid', aiToneInstructions: '' }),
  });
  assert.equal(configured.status, 303, `Native page initialization must succeed for ${email}`);
  await configured.body?.cancel();
  const opened = await request(new URL('/api/app/overview/first-run', origin).href, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ components: [] }),
  });
  assert.equal(opened.status, 200, 'Native first-run acknowledgement must complete');
  await opened.body?.cancel();
  return response;
}
