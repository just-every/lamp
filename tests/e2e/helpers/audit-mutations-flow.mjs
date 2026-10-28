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
  const cleared = (await request(claimPath, "PUT", { state: null })).component;
  assert.equal(cleared.publicState, "Major outage");
  assert.equal(cleared.standingClaimState, null);
  assert.deepEqual((await request(`/api/app/components/${component.id}/history`)).history, historyBefore,
    "clearing a masked claim creates no aggregate-state transition");

  const upload = async () => {
    const response = await uploadLogo();
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).settings;
  };
  const first = await upload();
  const replacement = await upload();
  assert.ok(first.logoKey && replacement.logoKey && first.logoKey !== replacement.logoKey);
  const removed = await request("/api/app/page-settings/logo", "DELETE");
  assert.equal(removed.settings.logoKey, null);
  const selected = `actorId=${encodeURIComponent(actor.id)}&from=${encodeURIComponent(since)}&limit=100`;
  const rows = (await request(`/api/app/audit-log?${selected}`)).entries;
  const claimRows = rows.filter(row => row.entityType === "component-standing-claim" && row.entityId === component.id && row.action === "deleted");
  const logoRows = rows.filter(row => row.entityType === "page-logo" && row.entityId === "default");
  assert.deepEqual({
    maskedClaimRemovals: claimRows.length,
    logoReplacements: logoRows.filter(row => row.action === "replaced").length,
    logoRemovals: logoRows.filter(row => row.action === "deleted").length,
  }, { maskedClaimRemovals: 1, logoReplacements: 1, logoRemovals: 1 },
  "logo replacement/removal and masked standing-claim removal each produce one attributed audit entry");
  for (const row of [...claimRows, ...logoRows]) {
    assert.equal(row.actorId, actor.id);
    assert.equal(row.actorName, actor.displayName);
    assert.ok(Date.parse(row.createdAt) >= Date.parse(since));
  }
  const response = await appFetch(`/api/app/audit-log?${selected}&format=csv`);
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.deepEqual(csv.trimEnd().split("\r\n").slice(1).map(line => line.match(/^"([^"]+)"/)[1]), rows.map(row => row.id),
    "the actor/time-filtered CSV matches the audit JSON");
  assert.ok(!csv.includes("branding/logos/"), "audit exports expose no storage locations");
  await request(`/api/app/incidents/${incident.id}`, "DELETE", { reason: "Audit fixture complete" });
  await request(`/api/app/components/${component.id}`, "DELETE", undefined, 204);
}
