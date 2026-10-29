import assert from 'node:assert/strict';

async function person({ request, origin, cookie }, path, method, body) {
  const response = await request(new URL(path, origin).href, { method,
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(response.ok, `Native journey fixture ${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

export async function connectIncidentChannel(input, componentId) {
  await person(input, '/api/app/channels', 'POST', { kind: 'slack', name: 'Incident coordination',
    url: 'https://hooks.slack.com/services/TCONFORMANCE/BJOURNEY/SyntheticLampWebhook',
    componentIds: [componentId], operatorAlerts: false });
}

/** Ordinary requests also run due work: make this window due immediately before its real call. */
export async function prepareReminder(input) {
  if (input.phase !== 'autonomous' || input.step.id !== 'pending-base-2026-10-28-reminder-window') return;
  const now = Date.now(), instant = hours => new Date(now + hours * 3600_000).toISOString();
  await person(input, `/api/app/maintenance/${input.args.id}/window`, 'PUT', {
    startsAt: instant(23), endsAt: instant(24), autoStart: false, autoComplete: false, social: false });
}
