import assert from "node:assert/strict";

/** Destructive changes are audited even when the public state stays the same. */
export async function auditMutationsFlow({ appFetch, uploadLogo }) {
  const since = new Date().toISOString();
  const request = async (path, method = "GET", body, status = 200) => {
    const response = await appFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
    return status === 204 ? null : response.json();
  };
  const actor = (await request("/api/app/session")).operator;
  const component = (await request("/api/app/components", "POST", {
    groupId: null, name: "synthetic-lamp-201", description: "Audit retention for masked claims", internal: false, displayOrder: 9201, note: "",
  }, 201)).component;
  const incident = (await request("/api/app/incidents", "POST", {
    title: "synthetic-lamp-202", components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }],
  }, 201)).incident;
  await request(`/api/app/incidents/${incident.id}/draft`, "PUT", {
    lifecycle: "Investigating", affectedAudience: "API customers", customerImpact: "Requests are unavailable.",
    whatStillWorks: "", details: "", nextUpdateAt: new Date(Date.now() + 3600000).toISOString(),
  });
  await request(`/api/app/incidents/${incident.id}/publish`, "POST", { channels: [] });
  const claimPath = `/api/app/components/${component.id}/standing-claim`;
  await request(claimPath, "PUT", { state: "Degraded performance" });
  const historyBefore = (await request(`/api/app/components/${component.id}/history`)).history;
  const clears = await Promise.all([request(claimPath, "PUT", { state: null }), request(claimPath, "PUT", { state: null })]);
  assert.ok(clears.every(row => row.component.publicState === "Major outage" && row.component.standingClaimState === null));
  await request(claimPath, "PUT", { state: null });
  assert.deepEqual((await request(`/api/app/components/${component.id}/history`)).history, historyBefore,
    "clearing a masked claim creates no aggregate-state transition");

  await request("/api/app/page-settings/logo", "DELETE");
  const first = await uploadLogo();
  const replacement = await uploadLogo();
  assert.ok(first.logoKey && replacement.logoKey && first.logoKey !== replacement.logoKey);
  const removals = await Promise.all([request("/api/app/page-settings/logo", "DELETE"), request("/api/app/page-settings/logo", "DELETE")]);
  assert.ok(removals.every(row => row.settings.logoKey === null));
  await request("/api/app/page-settings/logo", "DELETE");
  const selected = `actorId=${encodeURIComponent(actor.id)}&from=${encodeURIComponent(since)}&limit=100`;
  const rows = (await request(`/api/app/audit-log?${selected}`)).entries;
  const claimRows = rows.filter(row => row.entityType === "component-standing-claim" && row.entityId === component.id && row.action === "deleted");
  const logoRows = rows.filter(row => row.entityType === "page-logo" && row.entityId === "default");
  assert.deepEqual({
    maskedClaimRemovals: claimRows.length,
    logoReplacements: logoRows.filter(row => row.action === "replaced").length,
    logoRemovals: logoRows.filter(row => row.action === "deleted").length,
  }, { maskedClaimRemovals: 1, logoReplacements: 1, logoRemovals: 1 },
  "existing records alone produce attributed audit entries; repeated and competing removals add none");
  for (const row of [...claimRows, ...logoRows]) {
    assert.equal(row.actorId, actor.id);
    assert.equal(row.actorName, actor.displayName);
    assert.ok(Date.parse(row.createdAt) >= Date.parse(since));
  }
  for (const action of ["replaced", "deleted"]) {
    const filter = `${selected}&action=${action}`;
    const matching = (await request(`/api/app/audit-log?${filter}`)).entries;
    const response = await appFetch(`/api/app/audit-log?${filter}&format=csv`);
    assert.equal(response.status, 200);
    const csv = await response.text();
    assert.equal(csv.trimEnd().split("\r\n").length - 1, matching.length);
    for (const row of matching) assert.ok(csv.includes(`"${row.id}"`));
    assert.ok(!csv.includes("branding/logos/"), "audit exports expose no storage locations");
  }
  await request(`/api/app/incidents/${incident.id}`, "DELETE", { reason: "Audit fixture complete" });
  await request(`/api/app/components/${component.id}`, "DELETE", undefined, 204);
}
