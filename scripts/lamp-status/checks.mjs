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
      headers: { 'User-Agent': 'Lamp-Status/1.0 (+https://status.run-lamp.com)' },
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

export async function recordCheck(api, component, check, { internal = component.internal } = {}) {
  const { component: claimed } = await api(`/api/app/components/${component.id}/standing-claim`, {
    method: 'PUT', body: { state: check.state === 'Operational' ? null : check.state },
  });
  const note = `Last checked ${check.observedAt} · ${check.error ?? `HTTP ${check.status}`} · ${check.durationMs} ms · every 5 minutes`;
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
