import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";

export async function auditLogFlow({ page, appUrl, appFetch }) {
  const originalViewport = page.viewportSize();
  const since = new Date().toISOString();
  const request = async (path, method = "GET", body, status = 200) => {
    const response = await appFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
    return status === 204 ? null : response.json();
  };
  const component = (await request("/api/app/components", "POST", { groupId: null, name: "Checkout API audit journey", description: "Payment processing and checkout availability.", internal: false, displayOrder: 1001, note: "" }, 201)).component;
  await request(`/api/app/components/${component.id}/standing-claim`, "PUT", { state: "Degraded performance" });
  const reason = '=Restore measured availability, "operator correction"';
  await request(`/api/app/components/${component.id}/history-corrections`, "POST", { state: "Operational", startsAt: new Date(Date.now() - 120000).toISOString(), endsAt: new Date(Date.now() - 60000).toISOString(), reason }, 204);
  const incident = (await request("/api/app/incidents", "POST", { title: "Checkout communication audit", components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] }, 201)).incident;
  await request(`/api/app/incidents/${incident.id}/draft`, "PUT", { lifecycle: "Investigating", affectedAudience: "Customers checking out in the US", customerImpact: "Payment requests are delayed.", whatStillWorks: "Existing sessions remain available.", details: "Engineers are restoring capacity.", nextUpdateAt: new Date(Date.now() + 3600000).toISOString() });
  const publication = await request(`/api/app/incidents/${incident.id}/publish`, "POST", { channels: [] });
  const subscriber = (await request("/api/app/subscribers/webhook", "POST", { destination: "https://hooks.example.test/audit-journey", contactEmail: "audit-private@example.test", componentIds: [] }, 201)).subscriber;
  await request(`/api/app/subscribers/${subscriber.id}`, "DELETE", undefined, 204);
  const maintenance = (await request("/api/app/maintenance", "POST", { title: "Database capacity upgrade audit", startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(), componentIds: [component.id] }, 201)).maintenance;
  const group = (await request("/api/app/component-groups", "POST", { name: "Retired audit group", displayOrder: 9101 }, 201)).group;
  const retired = (await request("/api/app/components", "POST", { groupId: group.id, name: "Retired audit component", description: "Removed by the audit journey.", internal: false, displayOrder: 1002, note: "" }, 201)).component;
  await request(`/api/app/components/${retired.id}`, "DELETE", undefined, 204);
  await request(`/api/app/component-groups/${group.id}`, "DELETE", undefined, 204);
  await request(`/api/app/components/${retired.id}`, "DELETE", undefined, 404);
  // A stronger standing claim keeps the aggregate state unchanged while the
  // published incident attachment disappears.
  await request(`/api/app/components/${component.id}/standing-claim`, "PUT", { state: "Major outage" });
  const beforeDetach = (await request("/api/app/components")).components.find(row => row.id === component.id).publicState;
  assert.equal(beforeDetach, "Major outage");
  await request(`/api/app/incidents/${incident.id}/components/${component.id}`, "DELETE");
  assert.equal((await request("/api/app/components")).components.find(row => row.id === component.id).publicState, beforeDetach);
  await request(`/api/app/incidents/${incident.id}/components/${component.id}`, "DELETE", undefined, 400);
  const templateInput = { name: "synthetic-lamp-audit-template", lifecycle: "Investigating", affectedAudience: "API customers", customerImpact: "Requests are delayed.", whatStillWorks: "", details: "", nextUpdateOffsetMinutes: 60, components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] };
  const template = (await request("/api/app/incident-templates", "POST", templateInput, 201)).template;
  await request("/api/app/incident-templates", "POST", templateInput, 201);
  await request(`/api/app/incident-templates/${template.id}`, "PUT", { components: templateInput.components });
  const data = await request(`/api/app/audit-log?from=${encodeURIComponent(since)}&limit=100`);
  const published = data.entries.find(row => row.entityId === publication.update.id && row.action === "published");
  assert.ok(published?.actorId && published.actorName === "Contract Operator");
  assert.ok(data.entries.some(row => row.entityId === component.id && row.action === "state-changed"));
  assert.ok(data.entries.some(row => row.action === "corrected" && row.reason === reason));
  assert.ok(data.entries.some(row => row.entityId === subscriber.id && row.action === "deleted"));
  assert.ok(data.entries.some(row => row.entityId === maintenance.id && row.action === "notice-published"));
  for (const [entityType, entityId] of [["component", retired.id], ["component-group", group.id]]) {
    const deleted = data.entries.filter(row => row.entityId === entityId && row.action === "deleted");
    assert.equal(deleted.length, 1, `${entityType} deletion is recorded once, and a repeated delete records nothing`);
    assert.equal(deleted[0].entityType, entityType); assert.equal(deleted[0].actorId, published.actorId); assert.equal(deleted[0].actorName, "Contract Operator");
  }
  for (const [entityType, action, count] of [["incident-component", "deleted", 1], ["incident-template-components", "replaced", 2]]) {
    const entries = data.entries.filter(row => row.entityType === entityType && row.action === action);
    assert.equal(entries.length, count, `${entityType}: exactly one attributed entry per change`);
    assert.ok(entries.every(row => row.actorId === published.actorId));
    const selected = await request(`/api/app/audit-log?action=${action}&actorId=${published.actorId}&from=${encodeURIComponent(since)}&limit=100`);
    const response = await appFetch(`/api/app/audit-log?format=csv&action=${action}&actorId=${published.actorId}&from=${encodeURIComponent(since)}`);
    const text = await response.text();
    for (const entry of selected.entries) assert.ok(text.includes(`"${entry.id}"`));
    assert.equal(text.trimEnd().split("\r\n").length - 1, selected.entries.length);
  }
  assert.ok(data.entries.every(row => Number.isFinite(Date.parse(row.createdAt))));
  assert.ok(!JSON.stringify(data).includes("audit-private@example.test"));
  const selection = `actorId=${encodeURIComponent(published.actorId)}&action=corrected&from=${encodeURIComponent(since)}`;
  const filtered = await request(`/api/app/audit-log?${selection}`);
  assert.ok(filtered.entries.length);
  assert.ok(filtered.entries.every(row => row.actorId === published.actorId && row.action === "corrected"));
  const csv = await appFetch(`/api/app/audit-log?format=csv&${selection}`);
  assert.equal(csv.headers.get("cache-control"), "no-store");
  const exported = await csv.text();
  assert.ok(exported.includes(`"'${reason.replaceAll('"', '""')}"`), "CSV quotes reasons and neutralizes formulas");
  for (const entry of filtered.entries) assert.ok(exported.includes(`"${entry.id}"`));
  assert.equal(exported.trimEnd().split("\r\n").length - 1, filtered.entries.length);
  const first = await request("/api/app/audit-log?limit=1");
  const second = await request("/api/app/audit-log?limit=1&offset=1");
  assert.equal(first.hasMore, true); assert.notEqual(first.entries[0].id, second.entries[0].id);
  assert.equal((await appFetch("/api/app/audit-log?from=invalid")).status, 400);
  assert.equal((await fetch(`${appUrl}/api/app/audit-log`)).status, 401);
  const proof = process.env.LAMP_SCREENSHOTS;
  if (proof) await mkdir(proof, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1600 });
    await page.goto(`${appUrl}/app/settings`); await operatorHydrated(page);
    await page.getByRole("link", { name: "Your data", exact: true }).click();
    await page.getByRole("button", { name: "Open audit log", exact: true }).click();
    const panel = page.locator("#audit-log");
    await panel.getByRole("region", { name: "Audit entries", exact: true }).waitFor();
    await panel.getByLabel("Operator").selectOption(published.actorId);
    await panel.getByLabel("Audit action").selectOption("corrected");
    await panel.getByRole("button", { name: "Apply filters", exact: true }).click();
    await panel.getByText(reason, { exact: true }).waitFor();
    assert.equal(await panel.locator("tbody tr").count(), filtered.entries.length);
    const href = await panel.getByRole("link", { name: "Export matching audit CSV" }).getAttribute("href");
    assert.ok(href.includes("action=corrected") && href.includes("actorId="));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no document overflow");
    const axe = await new AxeBuilder({ page }).include("#audit-log").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), []);
    if (proof) await panel.screenshot({ path: `${proof}/${width}-audit-filtered.png` });
    await panel.getByLabel("Audit action").selectOption("deleted");
    await panel.getByRole("button", { name: "Apply filters", exact: true }).click();
    await panel.locator("tbody").getByText(group.id, { exact: true }).waitFor();
    await panel.locator("tbody").getByText(retired.id, { exact: true }).waitFor();
    if (proof) await panel.screenshot({ path: `${proof}/${width}-audit-deleted.png` });
    await panel.getByLabel("Audit action").selectOption("");
    await panel.getByRole("button", { name: "Apply filters", exact: true }).click();
    await panel.locator("tbody").getByText("published", { exact: true }).first().waitFor();
    if (proof) await panel.screenshot({ path: `${proof}/${width}-audit-all.png` });
  }
  await page.setViewportSize(originalViewport);
}
