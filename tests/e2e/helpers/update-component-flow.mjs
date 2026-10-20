import assert from "node:assert/strict";

/** Reusable customer wording for the parent's public, mail and chat edge journeys. */
export const UPDATE_LINK_FIELDS = {
  affectedAudience: "Customers using the publishing API.",
  customerImpact: "Customer name withheld: requests will be fixed in 10 minutes. See https://help.example.com/kb/123.",
  whatStillWorks: "Existing records remain available at https://help.example.com/kb/123, and the guide (https://help.example.com/kb/123) explains exports.",
  details: 'Contact ops@example.test. Literal <a href="https://x.test">x</a>, **markdown**, javascript:alert(1), http://example.com/x and data:text/html,x stay text. Internal https://db-prod-3.internal/x and https://10.0.0.5/x. Guide https://help.example.com/recovery.',
};

function settingsInput(settings) {
  return {
    pageName: settings.pageName, tagline: settings.tagline, accentColor: settings.accentColor,
    timezone: settings.timezone, hostname: settings.hostname, footerCreditEnabled: settings.footerCreditEnabled,
    widgetAllowedOrigins: settings.widgetAllowedOrigins, aiToneInstructions: settings.aiToneInstructions,
    wordingBlockedTerms: settings.wordingBlockedTerms, wordingFriendlyLength: settings.wordingFriendlyLength,
    ...(typeof settings.mailFromAddress === "string" ? { mailFromAddress: settings.mailFromAddress } : {}),
  };
}

/** Called with an actual captured SUB-009 receiver body, never a constructed repository payload. */
export function assertUpdateComponentWebhook(payload, { incident, component, stepDownUpdate, expectedChange }) {
  assert.equal(payload.event, "incident.update.published");
  assert.equal(payload.incident.reference, incident.reference);
  const changed = payload.components.find(item => item.id === component.id);
  assert.ok(changed, "the notification retains the affected component");
  assert.equal(changed.previousState, "Major outage");
  assert.equal(changed.newState, "Degraded performance", "this event keeps its own state after later publications");
  const update = payload.updates.find(item => item.id === stepDownUpdate.id);
  assert.ok(update, "the notification carries the immutable published update");
  assert.deepEqual(update.componentChanges, [expectedChange]);
  for (const [field, text] of Object.entries(UPDATE_LINK_FIELDS)) assert.equal(update[field], text, `generic webhook ${field} stays byte-for-byte raw text`);
}

/** Route-driven addition to an existing journey; registers no tests or browser processes.
 * channels may select a parent-owned fake network receiver; the default sends nowhere.
 * Return the fixture for public snapshot, email, chat and webhook edge assertions.
 */
export async function updateComponentFlow({ appFetch, channels = [] }) {
  const request = async (path, { method = "GET", body, version, status = 200 } = {}) => {
    const response = await appFetch(path, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(version ? { headers: { "If-Match": version } } : {}),
    });
    if (response.status !== status) throw new Error(`${method} ${path}: expected ${status}, received ${response.status}: ${await response.text()}`);
    return response.json();
  };
  const read = async id => (await request(`/api/app/incidents/${id}`)).incident;
  const history = async id => (await request(`/api/app/components/${id}/history`)).history;
  const state = async id => (await request("/api/app/components")).components.find(component => component.id === id).publicState;
  const save = async (id, lifecycle, componentChanges = []) => {
    const incident = await read(id);
    const { draft } = await request(`/api/app/incidents/${id}/draft`, {
      method: "PUT", version: `${incident.draft?.id ?? "-"}:${incident.updates.length}`,
      body: { ...UPDATE_LINK_FIELDS, lifecycle, nextUpdateAt: lifecycle === "Resolved" ? null : new Date(Date.now() + 3600_000).toISOString(), componentChanges },
    });
    return { draft, version: `${draft.id}:${incident.updates.length}` };
  };
  const publish = async (id, saved, extra = {}) => (await request(`/api/app/incidents/${id}/publish`, { method: "POST", version: saved.version, body: { channels, ...extra } })).update;
  const create = async (title, component, claim = "Major outage") => (await request("/api/app/incidents", {
    method: "POST", status: 201, body: { title, components: [{ componentId: component.id, state: claim, relationship: "Primary" }] },
  })).incident;
  const choice = (component, claim) => [{ componentId: component.id, state: claim, relationship: "Primary" }];
  const [settingsResult, componentResult] = await Promise.all([
    request("/api/app/page-settings"),
    request("/api/app/components", { method: "POST", status: 201, body: { groupId: null, name: "Update publishing API", description: "Isolated incident publication journey.", internal: false, displayOrder: 1000, note: "" } }),
  ]);
  const originalSettings = settingsInput(settingsResult.settings);
  const component = componentResult.component;
  try {
    const wording = { wordingBlockedTerms: ["Customer name withheld"], wordingFriendlyLength: 80 };
    await request("/api/app/page-settings", { method: "PUT", body: { ...originalSettings, ...wording } });
    const persisted = (await request("/api/app/page-settings")).settings;
    assert.deepEqual(persisted.wordingBlockedTerms, wording.wordingBlockedTerms);
    assert.equal(persisted.wordingFriendlyLength, wording.wordingFriendlyLength);
    const incident = await create("A staged publishing recovery", component);
    const configured = await request(`/api/app/incidents/${incident.id}`);
    assert.deepEqual(configured.wordingChecks, { blockedTerms: wording.wordingBlockedTerms, friendlyLength: wording.wordingFriendlyLength });
    await publish(incident.id, await save(incident.id, "Investigating"));
    assert.equal(await state(component.id), "Major outage", "advisory wording never prevents publication");

    const firstSave = await save(incident.id, "Monitoring", choice(component, "Degraded performance"));
    const retained = await read(incident.id);
    assert.equal(retained.draft.componentChanges[0].state, "Degraded performance");
    assert.equal(await state(component.id), "Major outage", "saving component choices changes no live state");
    const preview = await request(`/api/app/incidents/${incident.id}/draft/preview`, { method: "POST", body: {
      ...UPDATE_LINK_FIELDS, lifecycle: "Monitoring", nextUpdateAt: firstSave.draft.nextUpdateAt, componentChanges: choice(component, "Degraded performance"),
    } });
    assert.ok(preview.preview.public.fields.some(field => field.value === `${component.name}: Major outage → Degraded performance`));
    const saved = await save(incident.id, "Monitoring", choice(component, "Degraded performance"));
    const staleVersion = await appFetch(`/api/app/incidents/${incident.id}/publish`, { method: "POST", headers: { "If-Match": firstSave.version }, body: JSON.stringify({ channels: [] }) });
    assert.equal(staleVersion.status, 409, "a replaced draft cannot authorize publication");
    const before = new Set((await history(component.id)).map(entry => entry.id));
    const stepDownUpdate = await publish(incident.id, saved);
    const transitions = (await history(component.id)).filter(entry => !before.has(entry.id));
    assert.equal(transitions.length, 1, "the update commits one aggregate transition");
    assert.deepEqual([transitions[0].previousState, transitions[0].newState], ["Major outage", "Degraded performance"]);
    assert.equal(transitions[0].changedAt, stepDownUpdate.publishedAt);
    assert.equal(transitions[0].causeId, incident.id);
    assert.ok(transitions[0].operatorId, "the transition names its operator");
    assert.equal(await state(component.id), "Degraded performance");
    const expectedChange = { componentId: component.id, name: component.name, previousState: "Major outage", newState: "Degraded performance", internal: false };
    assert.deepEqual(stepDownUpdate.componentChanges, [expectedChange]);

    const overlapping = await create("A second claimant still affects this API", component);
    await publish(overlapping.id, await save(overlapping.id, "Investigating"));
    await publish(incident.id, await save(incident.id, "Identified"), { componentStates: { [component.id]: "Major outage" } });
    const overlapHistory = (await history(component.id)).map(entry => entry.id).sort();
    await publish(incident.id, await save(incident.id, "Monitoring", choice(component, "Degraded performance")));
    assert.deepEqual((await history(component.id)).map(entry => entry.id).sort(), overlapHistory, "a stronger overlapping claim prevents an aggregate transition");
    assert.equal(await state(component.id), "Major outage");
    await publish(overlapping.id, await save(overlapping.id, "Resolved"));

    await publish(incident.id, await save(incident.id, "Monitoring", choice(component, "Operational")));
    const released = await read(incident.id);
    assert.equal(released.components.find(item => item.componentId === component.id).state, "Operational", "release retains the attachment for subscribers");
    assert.equal(await state(component.id), "Operational");
    await publish(incident.id, await save(incident.id, "Monitoring", choice(component, "Degraded performance")));
    await publish(incident.id, await save(incident.id, "Resolved", choice(component, "Major outage")));
    const resolved = await read(incident.id);
    assert.equal(resolved.lifecycle, "Resolved");
    assert.equal(await state(component.id), "Operational", "Resolved releases even a staged non-operational claim");
    assert.deepEqual(resolved.updates.find(update => update.id === stepDownUpdate.id).componentChanges, [expectedChange], "later publications cannot rewrite the timeline's earlier component changes");

    const staleIncident = await create("An attachment changes after a draft was saved", component);
    await publish(staleIncident.id, await save(staleIncident.id, "Investigating"));
    const staged = await save(staleIncident.id, "Monitoring", choice(component, "Degraded performance"));
    await request(`/api/app/incidents/${staleIncident.id}/components/${component.id}`, { method: "DELETE" });
    const rejected = await appFetch(`/api/app/incidents/${staleIncident.id}/publish`, { method: "POST", headers: { "If-Match": staged.version }, body: JSON.stringify({ channels: [] }) });
    assert.equal(rejected.status, 409, "a removed attachment invalidates its staged claim");
    assert.equal((await read(staleIncident.id)).updates.length, 1, "the rejected publication adds no timeline update");
    return { incident, component, stepDownUpdate, expectedChange, fields: { ...UPDATE_LINK_FIELDS }, publicIncidentPath: `/incidents/${incident.reference}` };
  } finally {
    await request("/api/app/page-settings", { method: "PUT", body: originalSettings });
  }
}
