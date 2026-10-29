import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** AUTO-001 owner controls, persisted approval, public result and internal record.
 * Assertions use one desktop width. Optional evidence captures the same saved
 * screens at desktop and phone widths without repeating the user journey. */
export async function automationRulesBrowserFlow({ origin, publicOrigin, cookie, component, api, post }) {
  const target = await component("Prepared-rule API");
  const made = await post("/api/app/intake/sources", { name: "Prepared-rule monitor", preset: "datadog", componentId: target.id, credentialKind: "bearer-token" });
  assert.equal(made.status, 201, made.text);
  const source = made.body.source;
  const templateInput = {
    name: "Prepared API communication", lifecycle: "Investigating", affectedAudience: "Customers using the API",
    customerImpact: "API requests are delayed.", whatStillWorks: "The dashboard remains available.", details: "We are restoring API capacity.",
    nextUpdateOffsetMinutes: 60, components: [{ componentId: target.id, state: "Degraded performance", relationship: "Primary" }],
    channels: ["email"], resolvedUpdate: { affectedAudience: "Customers using the API", customerImpact: "API requests are working normally.", whatStillWorks: "The dashboard remains available.", details: "API capacity has recovered." },
  };
  const saved = await post("/api/app/incident-templates", templateInput);
  assert.equal(saved.status, 201, saved.text);
  const template = saved.body.template;
  const browser = await chromium.launch({ headless: true, ...((process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.LAMP_CHROMIUM_PATH) ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.LAMP_CHROMIUM_PATH } : {}), args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(cookie.split("; ").map(pair => ({ name: pair.slice(0, pair.indexOf("=")), value: pair.slice(pair.indexOf("=") + 1), url: origin })));
    const page = await context.newPage(), errors = [];
    const proof = process.env.LAMP_AUTO_SCREENSHOTS;
    if (proof) await mkdir(proof, { recursive: true });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /hydrat|did not match|server rendered/i.test(message.text())) errors.push(message.text()); });
    await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
    if (proof) await captureBoth("alert-entry", () => page.screenshot.bind(page));
    await page.getByRole("link", { name: "Manage alert rules in Settings", exact: true }).click();
    await operatorHydrated(page);
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    const rules = page.getByRole("region", { name: "Alert rules", exact: true });
    await rules.getByLabel("Rule source", { exact: true }).selectOption(source.id);
    await rules.getByLabel("Rule component", { exact: true }).selectOption(target.id);
    assert.equal(await rules.getByLabel("Alert action", { exact: true }).inputValue(), "draft", "a new component/source pair defaults to draft");
    await rules.getByLabel("Rule name", { exact: true }).fill("Prepared API availability");
    await rules.getByLabel("Alert action", { exact: true }).selectOption("claim");
    await rules.getByLabel("Claimed state", { exact: true }).selectOption("Degraded performance");
    assert.equal(await rules.getByLabel("Firing delay (seconds)", { exact: true }).inputValue(), "120");
    assert.equal(await rules.getByLabel("Recovery hold (seconds)", { exact: true }).inputValue(), "300");
    await rules.getByLabel("Firing delay (seconds)", { exact: true }).fill("0");
    await rules.getByLabel("Recovery hold (seconds)", { exact: true }).fill("0");
    await rules.getByRole("button", { name: "Save rule", exact: true }).click();
    await rules.getByText("Rule saved. Your approval is recorded in the audit log.", { exact: true }).waitFor();
    await page.reload(); await operatorHydrated(page);
    await rules.getByRole("button", { name: "Edit rule Prepared API availability", exact: true }).click();
    assert.equal(await rules.getByLabel("Alert action", { exact: true }).inputValue(), "claim");
    assert.equal(await rules.getByLabel("Claimed state", { exact: true }).inputValue(), "Degraded performance");
    await rules.getByLabel("Alert action", { exact: true }).selectOption("claim-and-publish");
    await rules.getByLabel("Rule template", { exact: true }).selectOption(template.id);
    await rules.getByText("Edit saved template", { exact: true }).click();
    if (proof) await captureBoth("template-controls", () => rules.screenshot.bind(rules));
    assert.equal(await rules.getByLabel("Template email", { exact: true }).isChecked(), true);
    assert.equal(await rules.getByLabel("Template webhook", { exact: true }).isChecked(), false);
    assert.equal(await rules.getByLabel("Resolved template customer impact", { exact: true }).inputValue(), templateInput.resolvedUpdate.customerImpact);
    await rules.getByLabel("Resolved template details", { exact: true }).fill("API capacity has recovered after verification.");
    await rules.getByRole("button", { name: "Save template changes", exact: true }).click();
    await rules.getByText("Template changes saved.", { exact: true }).waitFor();
    const persistedTemplate = (await api("/api/app/incident-templates")).body.templates.find(row => row.id === template.id);
    assert.equal(persistedTemplate.resolvedUpdate.details, "API capacity has recovered after verification.");
    assert.deepEqual(persistedTemplate.channels, ["email"]);
    await rules.getByRole("button", { name: "Save rule", exact: true }).click();
    await rules.getByText("Rule saved. Your approval is recorded in the audit log.", { exact: true }).waitFor();
    const rule = (await api("/api/app/intake/rules")).body.rules.find(row => row.sourceId === source.id && row.componentId === target.id);
    assert.equal(rule.mode, "claim-and-publish"); assert.equal(rule.templateId, template.id);
    assert.ok(rule.approvedByOperatorId && Number.isFinite(Date.parse(rule.updatedAt)));
    const textSizes = await rules.locator(".state-pill, .character-count").evaluateAll(elements => elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
    assert.ok(textSizes.length && textSizes.every(size => size >= 13), "rule badges and wording counters meet the 13px minimum at 1440");
    await audit("rule settings");
    if (proof) await captureBoth("rule-controls", () => rules.screenshot.bind(rules));
    await page.goto(`${origin}/app/settings#audit-log`); await operatorHydrated(page);
    const auditPanel = page.locator("#audit-log");
    await auditPanel.getByRole("button", { name: "Open audit log", exact: true }).click();
    // The audit API supplies the exact row id; the native view supplies the actor
    // and operator-formatted time alongside the action and rule record.
    const records = (await api("/api/app/audit-log?limit=100")).body.entries.filter(row => row.entityType === "alert-rule");
    const edited = records.find(row => row.action === "updated" && row.actorId === rule.approvedByOperatorId);
    assert.ok(edited, "an edit is in the native audit view's backing read");
    const auditRow = auditPanel.locator("tbody tr").filter({ hasText: edited.entityId }).filter({ hasText: "updated" }).first();
    await auditRow.waitFor();
    if (proof) await captureBoth("rule-audit", () => auditPanel.screenshot.bind(auditPanel));
    assert.ok((await auditRow.innerText()).includes(edited.actorName));
    assert.ok((await auditRow.locator("td").first().innerText()).trim(), "the rule edit displays its time");
    const alert = { alert_id: "prepared-api-alert", alert_cycle_key: "prepared-api-cycle", alert_transition: "Triggered", alert_title: "Untrusted alert wording must remain private" };
    const response = await fetch(source.endpointUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${source.token}` }, body: JSON.stringify(alert) });
    assert.equal(response.status, 202, await response.clone().text());
    const receipt = await response.json();
    const incidents = (await api("/api/app/incidents")).body.incidents;
    const automated = incidents.find(row => row.updates.some(update => update.customerImpact === templateInput.customerImpact));
    assert.ok(automated, "saved template publishes through the native intake door");
    await page.goto(`${publicOrigin}/incidents/${automated.reference}`);
    await page.getByText(templateInput.customerImpact, { exact: false }).first().waitFor();
    assert.ok(!(await page.locator("body").innerText()).includes(alert.alert_title));
    assert.ok(!(await page.locator("body").innerText()).includes(rule.approvedByName), "public updates omit the approving operator");
    await audit("public automatic update");
    if (proof) {
      await captureBoth("public-update", () => page.screenshot.bind(page));
      await page.goto(publicOrigin + "/");
      await captureBoth("public-home-firing", () => page.screenshot.bind(page));
    }
    await page.goto(`${origin}/app/incidents/${automated.id}`); await operatorHydrated(page);
    const timeline = page.locator(".incident-record");
    await timeline.getByText(templateInput.customerImpact, { exact: true }).waitFor();
    const internal = await page.locator("body").innerText();
    assert.ok(internal.includes("Prepared API availability") && internal.includes(receipt.receiptId), "the internal incident view identifies the rule and triggering alert");
    await audit("automatic incident timeline");
    if (proof) await captureBoth("internal-timeline", () => timeline.screenshot.bind(timeline));
    await page.goto(`${origin}/app/settings#alerts`); await operatorHydrated(page);
    await rules.getByRole("button", { name: `Edit rule ${rule.name}`, exact: true }).click();
    await rules.getByLabel("Rule name", { exact: true }).fill(`${rule.name} renamed`);
    const savedEdit = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes(`/intake/rules/${source.id}/${target.id}`));
    await rules.getByRole("button", { name: "Save rule", exact: true }).click();
    assert.equal((await savedEdit).status(), 200);
    const activeRun = (await api("/api/app/intake/rule-runs")).body.runs.find(row => row.ruleId === rule.id);
    assert.equal(activeRun.releasedAt, null, "the browser rename retains the active published run");
    if (proof) await captureBoth("renamed-rule", () => rules.screenshot.bind(rules));
    for (const body of [{ ...alert, repeatedDelivery: 1 }, { ...alert, alert_transition: "Recovered" }]) {
      const result = await fetch(source.endpointUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${source.token}` }, body: JSON.stringify(body) });
      assert.equal(result.status, 202, await result.clone().text());
    }
    const episodes = (await api("/api/app/intake/rule-runs")).body.runs.filter(row => row.ruleId === rule.id);
    assert.equal(episodes.length, 1, "renaming the firing rule keeps a single automatic incident");
    const recovered = (await api(`/api/app/incidents/${automated.id}`)).body.incident;
    assert.equal(recovered.lifecycle, "Resolved");
    assert.equal(recovered.updates.length, 2);
    await page.goto(`${publicOrigin}/incidents/${automated.reference}`);
    await page.getByText(persistedTemplate.resolvedUpdate.customerImpact, { exact: false }).first().waitFor();
    assert.ok(!(await page.locator("body").innerText()).includes(rule.approvedByName), "public recovery omits the approving operator");
    if (proof) {
      await captureBoth("public-edited-recovered", () => page.screenshot.bind(page));
      await page.goto(publicOrigin + "/history");
      await captureBoth("public-history-recovered", () => page.screenshot.bind(page));
      await page.goto(publicOrigin + "/");
      await captureBoth("public-home-recovered", () => page.screenshot.bind(page));
    }
    const broken = await api(`/api/app/incident-templates/${template.id}`, { method: "PUT", body: JSON.stringify({ resolvedUpdate: null }) });
    assert.equal(broken.status, 200, broken.text);
    const degraded = await fetch(source.endpointUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${source.token}` }, body: JSON.stringify({ ...alert, alert_cycle_key: "prepared-api-broken-cycle" }) });
    assert.equal(degraded.status, 202, await degraded.clone().text());
    await page.goto(`${origin}/app/settings#alerts`); await operatorHydrated(page);
    const attention = page.getByRole("region", { name: "Alert rules", exact: true });
    await attention.getByText(/Draft only:.*Resolved/).first().waitFor();
    assert.ok((await attention.innerText()).includes("Needs attention"), "a broken template visibly degrades the rule to draft");
    if (proof) await captureBoth("degraded-rule", () => attention.screenshot.bind(attention));
    assert.deepEqual(errors, [], "rule and publication screens have no page or hydration errors");

    async function audit(label) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow at 1440`);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(results.violations.filter(violation => ["serious", "critical"].includes(violation.impact)).map(violation => violation.id), [], `${label}: accessibility`);
    }
    async function captureBoth(name, capture) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await capture()({ path: `${proof}/${width}-${name}.png`, ...(name.startsWith("public-") ? { fullPage: true } : {}) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  } finally { await browser.close(); }
}
