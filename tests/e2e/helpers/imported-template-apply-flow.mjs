import assert from "node:assert/strict";

const sqlText = value => `'${value.replaceAll("'", "''")}'`;

/** Extends the existing template journey; does not register a test or launch a server.
 * The fixture uses exactly the imported template storage layout. Import transport,
 * custody and undo are covered by the caller's move-in journey.
 */
export async function importedTemplateApplyFlow({ appFetch, pageUrl, executeFixtureSql }) {
  const request = async (path, { method = "GET", body, version, status = 200 } = {}) => {
    const response = await appFetch(path, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(version ? { headers: { "If-Match": version } } : {}),
    });
    assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
    return response.json();
  };
  const read = async id => (await request(`/api/app/incidents/${id}`)).incident;
  const versionOf = incident => `${incident.draft?.id ?? "-"}:${incident.updates.length}`;
  const { component } = await request("/api/app/components", { method: "POST", status: 201, body: {
    groupId: null, name: "Imported template API", description: "Template application fixture.", internal: false, displayOrder: 1001, note: "",
  } });
  const { template: native } = await request("/api/app/incident-templates", { method: "POST", status: 201, body: {
    name: "Imported recovery wording", lifecycle: "Monitoring", affectedAudience: "Customers using Imported template API",
    customerImpact: "IMPORTED-TEMPLATE-PRIVATE-IMPACT", whatStillWorks: "Existing records remain available.", details: "",
    nextUpdateOffsetMinutes: 60, components: [{ componentId: component.id, state: "Degraded performance", relationship: "Primary" }],
  } });
  const source = { title: "Source recovery title", folder: "Customer recovery", shouldSendNotifications: false };
  const oversized = "IMPORTED-TEMPLATE-PRIVATE-DETAILS " + "Preserve every original word. ".repeat(22);
  await executeFixtureSql(`UPDATE incident_templates SET title=${sqlText(source.title)}, folder=${sqlText(source.folder)}, should_send_notifications=0, next_update_offset_minutes=NULL, details='', imported_fields_json=${sqlText(JSON.stringify({ details: oversized }))} WHERE id=${sqlText(native.id)}`);
  const imported = (await request("/api/app/incident-templates")).templates.find(template => template.id === native.id);
  assert.equal(imported.details, oversized, "the entire imported text is readable for editing");
  assert.deepEqual(imported.fieldsToShorten, ["details"]);
  for (const [key, value] of Object.entries(source)) assert.equal(imported[key], value);
  const originalComponents = imported.components;
  const { incident } = await request("/api/app/incidents", { method: "POST", status: 201, body: {
    title: "Operator's existing incident title", components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }],
  } });
  const applyPath = `/api/app/incidents/${incident.id}/templates/${native.id}/apply`;
  const original = await read(incident.id);
  await request(applyPath, { method: "POST", version: versionOf(original), status: 409 });
  assert.equal((await read(incident.id)).draft.id, original.draft.id, "refused application never replaces the draft");
  await request(`/api/app/incident-templates/${native.id}`, { method: "PUT", body: { details: oversized }, status: 400 });
  const shortened = "IMPORTED-TEMPLATE-PRIVATE-DETAILS: Recovery is being verified.";
  const { template: edited } = await request(`/api/app/incident-templates/${native.id}`, { method: "PUT", body: { details: shortened } });
  assert.equal(edited.id, imported.id);
  assert.equal(edited.details, shortened);
  assert.deepEqual(edited.fieldsToShorten, []);
  assert.deepEqual(edited.components, originalComponents, "wording edits preserve component attachment identities");
  assert.equal(edited.createdByOperatorId, imported.createdByOperatorId);
  assert.equal(edited.createdAt, imported.createdAt);
  assert.notEqual(edited.updatedAt, imported.updatedAt, "an edit is visible to conditional import undo");
  for (const [key, value] of Object.entries(source)) assert.equal(edited[key], value);
  const applied = await request(applyPath, { method: "POST", version: versionOf(original) });
  assert.deepEqual(applied.channels, [], "the source's false notification default clears all channels");
  for (const [key, value] of Object.entries(source)) assert.equal(applied.template[key], value);
  assert.equal(applied.draft.nextUpdateAt, null, "an import never invents a next-update promise");
  assert.equal(applied.draft.details, shortened);
  assert.equal(applied.draft.componentChanges.find(change => change.componentId === component.id).state, "Degraded performance");
  const retained = await read(incident.id);
  assert.equal(retained.title, original.title, "applying a template preserves the incident title");
  assert.equal(retained.updates.length, 0);
  assert.equal(retained.components.find(item => item.componentId === component.id).state, "Major outage", "template claim changes remain staged");
  assert.equal((await request("/api/app/components")).components.find(item => item.id === component.id).publicState, "Operational");
  await request(applyPath, { method: "POST", version: versionOf(original), status: 409 });
  await request(`/api/app/incidents/${incident.id}/publish`, { method: "POST", version: versionOf(retained), body: { channels: [] }, status: 400 });
  const deliveries = (await request("/api/app/deliveries")).deliveries;
  assert.equal(deliveries.some(delivery => delivery.incidentUpdateId === applied.draft.id), false, "private application queues no update delivery");
  const publicBody = await (await fetch(`${pageUrl}/`)).text();
  assert.equal(publicBody.includes(native.customerImpact), false);
  assert.equal(publicBody.includes(shortened), false);

  await request(`/api/app/incident-templates/${native.id}`, { method: "PUT", body: { shouldSendNotifications: true } });
  const withNotifications = await request(applyPath, { method: "POST", version: versionOf(retained) });
  assert.deepEqual(withNotifications.channels, ["email", "webhook", ...((await request(`/api/app/incidents/${incident.id}`)).hasChatChannels ? ["chat"] : [])]);
  await request(`/api/app/incident-templates/${native.id}`, { method: "PUT", body: { lifecycle: "Resolved", nextUpdateOffsetMinutes: 60 } });
  const resolved = await request(applyPath, { method: "POST", version: `${withNotifications.draft.id}:0` });
  assert.equal(resolved.draft.nextUpdateAt, null, "Resolved templates carry no next-update commitment even with an offset");
  assert.equal((await read(incident.id)).updates.length, 0);
  return { incidentId: incident.id, templateId: native.id, componentId: component.id };
}
