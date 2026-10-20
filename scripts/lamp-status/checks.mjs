import { userAgent } from './session.mjs';

export const targets = [
  { name: 'Site', url: 'https://run-lamp.com/' },
  { name: 'Docs', url: 'https://run-lamp.com/docs' },
  { name: 'Demo app', url: 'https://demo.run-lamp.com/' },
];

export async function probe(url) {
  const started = Date.now();
  let status = null;
  let error = null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000), redirect: 'follow', cache: 'no-store',
      headers: { 'User-Agent': userAgent },
    });
    status = response.status;
    await response.body?.cancel();
    if (new URL(response.url).origin !== new URL(url).origin) error = 'Unexpected redirect to another origin';
  } catch { error = 'Request failed or timed out'; }
  return { url, observedAt: new Date().toISOString(), durationMs: Date.now() - started,
    status, error, state: status === 200 && !error ? 'Operational' : 'Major outage' };
}

function metadata(component, note, internal = component.internal) {
  return { name: component.name, groupId: component.groupId, description: component.description,
    internal, onlyShowIfDegraded: component.onlyShowIfDegraded,
    uptimeStartDate: component.uptimeStartDate, note };
}

// The page's own time zone, as its operator and visitors read times.
const checkedAt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', day: 'numeric', month: 'short',
  hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });

function describe(check) {
  const result = check.error ? check.error.toLowerCase() : `HTTP ${check.status} in ${check.durationMs} ms`;
  return `Checked automatically every 5 minutes. Last check ${checkedAt.format(new Date(check.observedAt))}: ${result}.`;
}

export async function recordCheck(api, component, check, { internal = component.internal } = {}) {
  // The check owns this component's standing claim; an unchanged claim is not written again.
  const claim = check.state === 'Operational' ? null : check.state;
  const claimed = component.standingClaimState === claim ? component : (await api(`/api/app/components/${component.id}/standing-claim`, {
    method: 'PUT', body: { state: claim },
  })).component;
  const note = describe(check);
  const { component: saved } = await api(`/api/app/components/${component.id}`, {
    method: 'PUT', body: metadata(claimed, note, internal),
  });
  if (saved.publicState !== check.state || saved.note !== note) {
    throw new Error(`Lamp did not retain the measured state for ${component.name}; inspect other active claims.`);
  }
  return { componentId: saved.id, name: saved.name, publicState: saved.publicState, note: saved.note, ...check };
}

export async function createComponent(api, name, url) {
  // New components stay private until their first real check has been recorded.
  return (await api('/api/app/components', { method: 'POST', body: {
    name, groupId: null, description: url, internal: true, onlyShowIfDegraded: false,
    uptimeStartDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' }),
    displayOrder: targets.findIndex(target => target.name === name) + 1, note: '',
  } })).component;
}
