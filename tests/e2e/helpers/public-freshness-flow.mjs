import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { snapshotProxy } from "./snapshot-proxy.mjs";

export async function publicFreshnessFlow({ appFetch, appUrl, pageUrl, diagnostic }) {
  async function mutate(path, method, input, status = 200) {
    const response = await appFetch(path, { method, ...(input ? { body: JSON.stringify(input) } : {}) });
    const body = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${body}`);
    return body ? JSON.parse(body) : null;
  }
  const { component } = await mutate("/api/app/components", "POST", { groupId: null, name: "Cache freshness service", description: "", internal: false, displayOrder: 0, note: "" }, 201);
  const { incident } = await mutate("/api/app/incidents", "POST", { title: "Cache freshness incident", components: [{ componentId: component.id, state: "Degraded performance", relationship: "Primary" }] }, 201);
  async function draft(lifecycle, customerImpact) {
    await mutate(`/api/app/incidents/${incident.id}/draft`, "PUT", {
      lifecycle, affectedAudience: "Public readers", customerImpact,
      whatStillWorks: "The status page is available.", details: "Cache freshness flow.",
      nextUpdateAt: lifecycle === "Resolved" ? null : new Date(Date.now() + 3600000).toISOString(),
    });
  }
  const publish = () => mutate(`/api/app/incidents/${incident.id}/publish`, "POST", { channels: [] });
  await draft("Investigating", "Initial customer impact.");
  await publish();
  const { maintenance } = await mutate("/api/app/maintenance", "POST", { affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.",
    title: "Cache freshness maintenance", componentIds: [component.id],
    startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(),
  }, 201);
  // Let initial background publication finish before warming either cache.
  const setupDeadline = performance.now() + 10000;
  while (true) {
    const html = await (await fetch(`${pageUrl}/`)).text();
    if (html.includes(maintenance.title) && html.includes("Initial customer impact.")) break;
    assert.ok(performance.now() < setupDeadline, "initial snapshot published");
    await delay(100);
  }
  const proxy = await snapshotProxy(pageUrl);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${pageUrl}/`, { waitUntil: "networkidle" });
    const signIn = page.getByRole("link", { name: "Sign in", exact: true });
    assert.equal(await signIn.getAttribute("href"), `${appUrl}/signin`, "installed action preserves local scheme/port and configured app hostname");
    assert.equal(await page.locator("footer [data-lamp-signin]").count(), 1, "operator entry belongs in the footer");
    assert.equal(await page.locator(".masthead [data-lamp-signin]").count(), 0, "customer navigation keeps its three destinations");
    await signIn.click();
    await page.waitForURL(`${appUrl}/signin`);
    assert.ok(await page.locator('input[type="email"]').isVisible(), "action reaches native sign-in");
    await page.goto(`${proxy.origin}/`, { waitUntil: "networkidle" });
    const paths = ["/", "/history", "/feed.atom", "/widget.js", "/api/public/status", `/incidents/${incident.reference}`, `/maintenance/${maintenance.reference}`];
    const read = () => page.evaluate(async paths => Promise.all(paths.map(async path => {
      const response = await fetch(path); // ordinary browser cache semantics
      return { path, status: response.status, generatedAt: response.headers.get("X-Lamp-Snapshot-Generated-At"), body: await response.text() };
    })), paths);
    let warmed = await read();
    warmed = await read();
    assert.ok(warmed.every(item => item.status === 200 && item.generatedAt), "all public surfaces warmed");
    const byPath = items => Object.fromEntries(items.map(item => [item.path, item.body]));
    async function measure(label, action, check) {
      const before = warmed[0].generatedAt;
      await action();
      const acceptedAt = performance.now();
      let observed;
      let expected;
      do {
        // Direct origin read only identifies the generation selected by R2.
        // Acceptance reads all go through the already-warmed browser and proxy.
        const current = await fetch(`${pageUrl}/api/public/status`);
        expected = current.headers.get("X-Lamp-Snapshot-Generated-At");
        observed = await read();
        if (expected !== before && observed.every(item => item.status === 200 && item.generatedAt === expected) && check(byPath(observed))) break;
        await delay(100);
      } while (performance.now() - acceptedAt < 10000);
      const elapsed = performance.now() - acceptedAt;
      diagnostic(`${label}: ${elapsed.toFixed(1)} ms after accepted mutation; generation ${expected}`);
      assert.ok(elapsed <= 10000, `${label} exceeded 10 seconds with warm browser/proxy caches`);
      assert.notEqual(expected, before, `${label} publishes a new generation`);
      for (const item of observed) assert.equal(item.generatedAt, expected, `${label} ${item.path} returns the selected generation`);
      assert.ok(check(byPath(observed)), `${label} public bytes contain the new facts`);
      warmed = observed;
    }
    await draft("Identified", "Fresh diagnosis reaches every customer.");
    await measure("incident update", publish, bodies => ["/", "/feed.atom", "/widget.js", "/api/public/status", `/incidents/${incident.reference}`].every(path => bodies[path].includes("Fresh diagnosis reaches every customer.")));
    await measure("component change", () => mutate(`/api/app/components/${component.id}/standing-claim`, "PUT", { state: "Major outage" }), bodies => ["/", "/widget.js", "/api/public/status"].every(path => bodies[path].includes("Major outage")));
    await measure("maintenance start", async () => {
      // Keep the window in the future while warming caches: request-assisted
      // due work must not start it before this measured action.
      await mutate(`/api/app/maintenance/${maintenance.id}/window`, "PUT", { startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() });
      const response = await fetch(`${appUrl}/cdn-cgi/handler/scheduled`);
      assert.equal(response.status, 200, await response.text());
    }, bodies => bodies[`/maintenance/${maintenance.reference}`].includes("In progress"));
    await measure("maintenance end", () => mutate(`/api/app/maintenance/${maintenance.id}/complete`, "POST"), bodies => bodies[`/maintenance/${maintenance.reference}`].includes("Completed") && bodies["/history"].includes(maintenance.title));
    await draft("Resolved", "Fresh recovery reaches history readers.");
    await measure("incident resolution", publish, bodies => bodies["/history"].includes("Fresh recovery reaches history readers.") && bodies[`/incidents/${incident.reference}`].includes("Fresh recovery reaches history readers."));
    assert.ok(proxy.stats.notModified > 0, "healthy unchanged generations validate without retransmitting bodies");
    // Origin/Worker failure is different from an R2 outage handled inside Lamp.
    // Disconnect only that network edge; its HTTP cache must retain the bytes.
    proxy.disconnect();
    for (const path of paths) {
      const response = await fetch(`${proxy.origin}${path}`);
      assert.equal(response.status, 200, `disconnected origin retains ${path}`);
      assert.equal(response.headers.get("Warning"), '110 - "Response is stale"');
      assert.equal(await response.text(), warmed.find(item => item.path === path).body);
    }
    diagnostic(`proxy validations=${proxy.stats.validations}, unchanged generations=${proxy.stats.notModified}, outage responses=${proxy.stats.stale}`);
  } finally {
    await browser?.close();
    await proxy.close();
    await mutate(`/api/app/incidents/${incident.id}`, "DELETE", { reason: "Remove cache freshness journey incident." });
    const windows = await mutate("/api/app/maintenance", "GET");
    const window = windows.maintenance.find(row => row.id === maintenance.id);
    if (window?.state === "Scheduled") await mutate(`/api/app/maintenance/${maintenance.id}/cancel`, "POST");
    else if (window?.state === "In progress") await mutate(`/api/app/maintenance/${maintenance.id}/complete`, "POST");
    // The standing claim must not change later tests' initial status or component count.
    await mutate(`/api/app/components/${component.id}`, "DELETE", undefined, 204);
    const cleanupDeadline = performance.now() + 10000;
    while (true) {
      const response = await fetch(`${pageUrl}/`);
      const html = await response.text();
      if (response.status === 200 && !html.includes(`<h4>${component.name}</h4>`)) break;
      assert.ok(performance.now() < cleanupDeadline, "freshness component removal published");
      await delay(100);
    }
  }
}
