import assert from "node:assert/strict";

/** Extends a publishing journey through actual routes; registers no test or server. */
export async function incidentImpactFlow({ appFetch, pageUrl, publicFetch = fetch }) {
  const request = async (path, { method = "GET", body, version, status = 200 } = {}) => {
    const response = await appFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(version ? { headers: { "If-Match": version } } : {}) });
    assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
    return response.json();
  };
  const publicJson = async path => {
    const response = await publicFetch(`${pageUrl}${path}`);
    assert.equal(response.status, 200, path);
    return response.json();
  };
  const collection = async name => {
    const records = [];
    let cursor = null;
    do {
      const page = await publicJson(`/api/public/v1/${name}${cursor ? `?cursor=${cursor}` : ""}`);
      records.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
    return records;
  };
  const publish = async (incidentId, lifecycle) => {
    const { incident } = await request(`/api/app/incidents/${incidentId}`);
    const { draft } = await request(`/api/app/incidents/${incidentId}/draft`, { method: "PUT", version: `${incident.draft?.id ?? "-"}:${incident.updates.length}`, body: {
      lifecycle, affectedAudience: "Impact feature customers", customerImpact: lifecycle === "Resolved" ? "Service has recovered." : "Requests are slower than usual.", whatStillWorks: "Requests continue to complete.", details: "Operators are tracking service performance.", nextUpdateAt: lifecycle === "Resolved" ? null : new Date(Date.now() + 3600_000).toISOString(),
    } });
    return request(`/api/app/incidents/${incidentId}/publish`, { method: "POST", version: `${draft.id}:${incident.updates.length}`, body: { channels: [] } });
  };
  const { component } = await request("/api/app/components", { method: "POST", status: 201, body: { name: "Incident impact service", groupId: null, description: "An isolated claims and impact journey.", internal: false, displayOrder: 1001, note: "" } });
  const { incident } = await request("/api/app/incidents", { method: "POST", status: 201, body: { title: "Incident impact follows operator choice", components: [{ componentId: component.id, state: "Degraded performance", relationship: "Primary" }] } });
  const endpoint = `/api/app/incidents/${incident.id}/impact`;
  const { update: firstUpdate } = await publish(incident.id, "Investigating");
  // Publication completes its snapshot after responding. Read the actual
  // public generation before using it as the comparison for this mutation.
  let publicIncident;
  const publishedDeadline = Date.now() + 10_000;
  do {
    publicIncident = (await publicJson("/api/v2/incidents.json")).incidents.find(row => row.shortlink.endsWith(`/${incident.reference}`));
    if (publicIncident?.incident_updates.some(update => update.id && update.body.includes("Requests are slower than usual."))) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < publishedDeadline);
  assert.ok(publicIncident?.incident_updates.some(update => update.body.includes("Requests are slower than usual.")), `the committed update ${firstUpdate.id} reaches the public generation`);
  const before = (await collection("components")).find(row => row.id === component.id);
  const beforeHistory = (await request(`/api/app/components/${component.id}/history`)).history;
  const beforeV2 = publicIncident;
  const beforeOverall = (await publicJson("/api/v2/status.json")).status;
  assert.equal((await request(endpoint)).impact.derivedImpact, "minor");
  await request(endpoint, { method: "PUT", body: { impactOverride: "catastrophic" }, status: 400 });
  const { impact } = await request(endpoint, { method: "PUT", body: { impactOverride: "major" } });
  assert.deepEqual([impact.derivedImpact, impact.impactOverride, impact.effectiveImpact], ["minor", "major", "major"]);
  assert.equal(impact.history[0].impactOverride, "major");
  assert.equal(impact.history[0].previousOverride, null);
  assert.ok(impact.history[0].operatorId && impact.history[0].operatorName);
  assert.ok(Number.isFinite(Date.parse(impact.history[0].createdAt)));

  const native = (await collection("incidents")).find(row => row.id === incident.id);
  assert.deepEqual([native.impact, native.derivedImpact, native.impactOverride], ["major", "minor", "major"]);
  const v2 = (await publicJson("/api/v2/incidents.json")).incidents.find(row => row.shortlink.endsWith(`/${incident.reference}`));
  assert.equal(v2.impact, "major");
  assert.deepEqual(v2.incident_updates, beforeV2.incident_updates, "changing impact leaves published update wording unchanged");
  for (const path of ["/", `/incidents/${incident.reference}`]) {
    const response = await publicFetch(`${pageUrl}${path}`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('data-incident-impact="major"'), path);
  }
  const widget = await publicJson("/api/public/status");
  if (widget.incident?.reference === incident.reference) assert.equal(widget.incident.impact, "major");
  const after = (await collection("components")).find(row => row.id === component.id);
  assert.equal(after.state, "Degraded performance");
  assert.equal(after.state, before.state);
  // The live percentage changes as real degraded time accrues. Its inputs,
  // start point and completed days must remain unchanged by the override.
  assert.ok(Number.isFinite(Number.parseFloat(after.uptime.percentage)));
  assert.equal(after.uptime.trackingSince, before.uptime.trackingSince);
  // Live downtime naturally accrues between snapshots. Completed days and
  // the underlying history must stay identical when communication changes.
  assert.deepEqual(after.uptime.marks.slice(0, -1), before.uptime.marks.slice(0, -1));
  assert.deepEqual((await request(`/api/app/components/${component.id}/history`)).history, beforeHistory);
  assert.deepEqual((await publicJson("/api/v2/status.json")).status, beforeOverall);

  const none = (await request(endpoint, { method: "PUT", body: { impactOverride: "none" } })).impact;
  assert.equal(none.effectiveImpact, "none", "none is an explicit choice below derived impact");
  assert.equal(none.derivedImpact, "minor");
  assert.equal((await publicJson("/api/v2/incidents.json")).incidents.find(row => row.shortlink.endsWith(`/${incident.reference}`)).impact, "none");
  const cleared = (await request(endpoint, { method: "PUT", body: { impactOverride: null } })).impact;
  assert.deepEqual([cleared.impactOverride, cleared.effectiveImpact], [null, "minor"]);
  const history = (await request(`${endpoint}/history`)).history;
  assert.deepEqual(history.map(row => [row.previousOverride, row.impactOverride]), [["none", null], ["major", "none"], [null, "major"]]);
  assert.ok(history.every(row => row.operatorId === impact.history[0].operatorId && row.operatorName && Number.isFinite(Date.parse(row.createdAt))));
  assert.equal((await publicJson("/api/v2/incidents.json")).incidents.find(row => row.shortlink.endsWith(`/${incident.reference}`)).impact, "minor");
  await publish(incident.id, "Resolved");
  const resolved = (await request(endpoint, { method: "PUT", body: { impactOverride: "major" } })).impact;
  assert.equal(resolved.derivedImpact, "minor", "resolution retains the claims-derived peak");
  const historyPage = await publicFetch(`${pageUrl}/history`);
  assert.equal(historyPage.status, 200);
  assert.ok((await historyPage.text()).includes('data-incident-impact="major"'));
  await request(endpoint, { method: "PUT", body: { impactOverride: null } });
  return { incident, component };
}
