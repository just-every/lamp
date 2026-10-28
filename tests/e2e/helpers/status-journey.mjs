import assert from 'node:assert/strict';
import { openFollowUpsRuntime, eventuallyFollowUp } from './follow-ups-runtime.mjs';
import { UPDATE_LINK_FIELDS } from './update-component-flow.mjs';

export { eventuallyFollowUp as eventually };
// Readiness uses the text a reader sees. Linked HTTPS fields legitimately split
// the original string across anchor markup; the journeys also assert the exact
// escaping/link rendering and the raw saved fields after readiness.
export function visibleText(html) {
  return html.replace(/<[^>]*>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}

export const wording = {
  lifecycle: 'Identified', ...UPDATE_LINK_FIELDS,
};

export async function openStatusJourney(options = {}) {
  const fixture = await openFollowUpsRuntime({ workerEntry: 'tests/e2e/helpers/status-journey.worker.ts', ...options });
  const json = async (path, method = 'GET', body, status = 200) => {
    const response = await fixture.api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${method} ${path}: ${response.text}`);
    return response.body;
  };
  const read = async id => (await json(`/api/app/incidents/${id}`)).incident;
  const component = async (name, patch = {}) => (await json('/api/app/components', 'POST', {
    name, groupId: null, description: '', internal: false, displayOrder: 0, note: '', ...patch,
  }, 201)).component;
  const incident = async (title, selected, patch = {}) => (await json('/api/app/incidents', 'POST', {
    title, components: selected.map(item => ({ componentId: item.id, state: 'Major outage', relationship: 'Primary' })), ...patch,
  }, 201)).incident;
  const save = async (id, patch = {}) => json(`/api/app/incidents/${id}/draft`, 'PUT', {
    ...wording, nextUpdateAt: new Date(Date.now() + 3600_000).toISOString(), ...patch,
  });
  const publish = (id, patch = {}, status = 200) => json(`/api/app/incidents/${id}/publish`, 'POST', { channels: [], ...patch }, status);
  const publicResponse = path => fixture.raw(new URL(path, fixture.publicOrigin).href);
  const publicText = async path => {
    const response = await publicResponse(path);
    assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
    return response.text();
  };
  const visible = (path, text) => eventuallyFollowUp(() => publicText(path), body => visibleText(body).includes(text), `${text} reaches ${path}`);
  const tick = async at => {
    const result = await (await fixture.runtime.getWorker()).scheduled({ cron: '* * * * *', scheduledTime: at });
    assert.equal(result.outcome, 'ok');
  };
  return { ...fixture, json, read, component, incident, save, publish, publicResponse, publicText, visible, tick };
}
