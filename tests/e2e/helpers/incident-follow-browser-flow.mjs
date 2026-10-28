import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { eventuallySubscriber } from "./subscriber-management-fixture.mjs";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** One functional width; the same changed screens are recorded at both widths. */
export async function incidentFollowBrowserFlow({ page: operatorPage, origin, pageOrigin, api, post, raw, messages }) {
  await operatorPage.setViewportSize({ width: 1440, height: 1000 });
  await operatorPage.goto(`${origin}/app/settings#notifications`);
  await operatorHydrated(operatorPage);
  const reportChoice = operatorPage.getByRole("checkbox", { name: "Include the post-incident report", exact: true });
  assert.equal(await reportChoice.isChecked(), true, "the owner-facing report option defaults on");
  const saveChoice = operatorPage.waitForResponse(response => new URL(response.url()).pathname === "/api/app/incident-follow-settings" && response.request().method() === "PATCH");
  await reportChoice.uncheck();
  assert.equal((await saveChoice).status(), 200);
  await operatorPage.reload(); await operatorHydrated(operatorPage);
  assert.equal(await reportChoice.isChecked(), false, "the owner's incident report choice survives reload");
  const restoreChoice = operatorPage.waitForResponse(response => new URL(response.url()).pathname === "/api/app/incident-follow-settings" && response.request().method() === "PATCH");
  await reportChoice.check();
  assert.equal((await restoreChoice).status(), 200);
  const componentResult = await post("/api/app/components", { groupId: null, name: "Synthetic Lamp browser follow API", description: "", internal: false, displayOrder: 0, note: "" });
  assert.equal(componentResult.status, 201, componentResult.text);
  for (let number = 1; number <= 6; number++) {
    const earlier = await post("/api/app/incidents", { title: `Synthetic Lamp earlier browser incident ${number}`, components: [{ componentId: componentResult.body.component.id, state: "Partially unavailable", relationship: "Primary" }] });
    assert.equal(earlier.status, 201, earlier.text);
  }
  const created = await post("/api/app/incidents", { title: "Synthetic Lamp browser-follow incident", components: [{ componentId: componentResult.body.component.id, state: "Partially unavailable", relationship: "Primary" }] });
  assert.equal(created.status, 201, created.text);
  const incident = created.body.incident;
  assert.equal(incident.reference, "INC-7", "the script-free browser follows the acceptance incident itself");
  const saved = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Investigating", affectedAudience: "Synthetic Lamp API readers", customerImpact: "Synthetic Lamp browser-follow requests are delayed.", whatStillWorks: "The status page remains available.", details: "The operator is investigating.", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() }) });
  assert.equal(saved.status, 200, saved.text);
  assert.equal((await post(`/api/app/incidents/${incident.id}/publish`, { channels: [] })).status, 200);
  const url = `${pageOrigin}/incidents/${incident.reference}`;
  const initialHtml = await eventuallySubscriber(async () => {
    const response = await raw(url);
    return response.status === 200 ? response.text() : "";
  }, html => html.includes("Synthetic Lamp browser-follow requests are delayed."), "the browser's exact incident permalink is published");
  assert.match(initialHtml, /Get updates on this incident/);
  assert.ok(gzipSync(initialHtml).byteLength <= 50 * 1024, "the initial incident follow form retains PAGE-003's gzip bound");
  const noScript = await operatorPage.context().browser().newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
  const page = await noScript.newPage();
  const errors = [];
  operatorPage.on("pageerror", error => { if (/hydration|did not match|server rendered/i.test(error.message)) errors.push(error.message); });
  const auditStatic = async (targetPage, selector, label) => {
    const auditContext = await operatorPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const auditPage = await auditContext.newPage();
      const url = targetPage.url(), html = await targetPage.content();
      // Read the exact no-script DOM with the same first-party CSS. The main
      // request is fulfilled locally so a confirmation token is never reused.
      await auditPage.route(url, route => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
      await auditPage.goto(url);
      const audit = await new AxeBuilder({ page: auditPage }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(audit.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), [], `${label}: static document axe`);
    } finally { await auditContext.close(); }
  };
  const capture = async (targetPage, label, selector = "main") => {
    for (const width of [1440, 390]) {
      await targetPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const target = targetPage.locator(selector);
      await target.scrollIntoViewIfNeeded();
      if (width === 1440) {
        assert.ok(await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no horizontal overflow`);
        if (targetPage === operatorPage) {
          const audit = await new AxeBuilder({ page: targetPage }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
          assert.deepEqual(audit.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), [], `${label}: axe`);
          assert.deepEqual(errors, [], `${label}: no hydration mismatch`);
        } else { await auditStatic(targetPage, selector, label); }
      }
      if (process.env.LAMP_INCIDENT_FOLLOW_EVIDENCE) {
        await mkdir(process.env.LAMP_INCIDENT_FOLLOW_EVIDENCE, { recursive: true });
        await target.screenshot({ path: join(process.env.LAMP_INCIDENT_FOLLOW_EVIDENCE, `incident-follow-${label}-${width}.png`) });
      }
    }
    await targetPage.setViewportSize({ width: 1440, height: 1000 });
  };
  try {
    await capture(operatorPage, "settings", 'section[aria-labelledby="incident-follow-settings-title"]');
    const assets = new Set(), thirdParty = new Set();
    page.on("request", request => {
      const requested = new URL(request.url());
      if (request.resourceType() === "document" || !["http:", "https:"].includes(requested.protocol)) return;
      (requested.origin === pageOrigin ? assets : thirdParty).add(requested.pathname);
    });
    await page.goto(url, { waitUntil: "networkidle" });
    const form = page.locator('#incident-follow form').filter({ has: page.getByRole("button", { name: "Get incident updates", exact: true }) });
    assert.equal(await form.getAttribute("method"), "post");
    assert.equal(await form.getAttribute("action"), "/subscribe/incident");
    assert.equal(await form.locator('input[name="incidentId"]').getAttribute("value"), incident.id);
    assert.equal(await page.locator('#incident-follow input[name="channel"][value="sms"]').count(), 1, "SMS is offered when SUB-013 is enabled on this installation");
    assert.ok(assets.size <= 4, `PAGE-003: initial incident request uses ${assets.size} same-origin assets`);
    assert.deepEqual([...thirdParty], [], "the initial form loads no third-party resource");
    const email = "synthetic-lamp-follow-browser@example.test";
    await form.getByLabel("Email address", { exact: true }).fill(email);
    await capture(page, "permalink", "#incident-follow");
    const accepted = page.waitForResponse(response => new URL(response.url()).pathname === "/subscribe/incident" && response.request().method() === "POST");
    await form.getByRole("button", { name: "Get incident updates", exact: true }).click();
    assert.equal((await accepted).status(), 202, "the incident form's standard POST succeeds with JavaScript disabled");
    await page.getByRole("heading", { name: "Check your inbox", exact: true }).waitFor();
    const invitation = messages.find(message => message.to.includes(email) && /\/confirm-subscription\//.test(message.text));
    assert.ok(invitation, "the native form sends its signed confirmation through the real mail adapter");
    const confirmUrl = invitation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
    const manageUrl = invitation.text.match(/https?:\/\/\S+\/manage\/\S+/)[0];
    assert.equal((await page.goto(confirmUrl)).status(), 200);
    await page.getByRole("heading", { name: "Subscription confirmed", exact: true }).waitFor();
    await capture(page, "confirmation");
    assert.equal((await page.goto(manageUrl)).status(), 200);
    await page.getByText(`Following ${incident.reference}`, { exact: true }).waitFor();
    assert.equal(await page.locator('input[name="componentId"]').count(), 0, "the incident token cannot expand its scope to components");
    await capture(page, "management");
    await operatorPage.goto(`${origin}/app/incidents/${incident.id}`);
    await operatorHydrated(operatorPage);
    const incidentSection = operatorPage.locator('section[aria-labelledby="incident-subscribers-title"]');
    await incidentSection.getByText(email, { exact: true }).waitFor();
    await capture(operatorPage, "operator-incident", 'section[aria-labelledby="incident-subscribers-title"]');
    await operatorPage.goto(`${origin}/app/subscribers`);
    await operatorHydrated(operatorPage);
    const row = operatorPage.getByRole("row").filter({ hasText: email });
    await row.getByRole("link", { name: `Following ${incident.reference}`, exact: true }).waitFor();
    await capture(operatorPage, "operator-subscribers", ".subscriber-directory-card");
    await page.getByRole("button", { name: "Unsubscribe", exact: true }).click();
    await page.getByRole("heading", { name: "Unsubscribed", exact: true }).waitFor();
    assert.equal((await raw(manageUrl)).status, 404, "the script-free token form revokes following immediately");
  } finally { await noScript.close(); }
}
