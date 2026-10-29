import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** New Relic's displayed workflow is the payload the owner actually installs. */
export async function monitorSetupJourney({ origin, publicOrigin, cookie, component, api }) {
  const target = await component("Workflow-monitored API");
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.LAMP_CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split("; ").map(pair => ({ name: pair.slice(0, pair.indexOf("=")), value: pair.slice(pair.indexOf("=") + 1), url: origin })));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /hydrat|did not match|server rendered/i.test(message.text())) errors.push(message.text()); });
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    const editor = page.locator("section.tool-form");
    const template = editor.getByRole("textbox", { name: "New Relic workflow template", exact: true });
    const entities = ["checkout-api", "checkout-worker"];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
      await page.getByRole("button", { name: "New Relic", exact: true }).click();
      await editor.getByRole("combobox", { name: "Component", exact: true }).selectOption(target.id);
      await inspect("component");
      await editor.getByRole("button", { name: "Connect New Relic", exact: true }).click();
      await template.waitFor();
      const displayedTemplate = await template.inputValue();
      assert.equal(displayedTemplate, '{\n  "issueId": {{json issueId}},\n  "title": {{json issueTitle}},\n  "state": {{json state}},\n  "entityNames": {{json entitiesData.names}}\n}', "the workflow includes every required New Relic binding");
      const firstAddress = await editor.getByRole("textbox", { name: "New Relic address", exact: true }).inputValue();
      const connected = (await api("/api/app/intake/sources")).body.sources.find(row => firstAddress.includes(`/api/intake/${row.id}/`));
      assert.ok(connected);
      await inspect("template");
      await editor.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: `Edit ${connected.name}`, exact: true }).click();
      await editor.getByLabel("Entity names", { exact: true }).fill(entities.join("\n"));
      // Closing flushes the ordinary autosave before the owner reloads.
      await editor.getByRole("button", { name: "Close", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      await page.reload(); await operatorHydrated(page);
      await page.getByRole("button", { name: `Edit ${connected.name}`, exact: true }).click();
      assert.equal(await editor.getByLabel("Entity names", { exact: true }).inputValue(), entities.join("\n"), "exact entity names survive reload");
      const saved = (await api("/api/app/intake/sources")).body.sources.find(row => row.id === connected.id);
      assert.deepEqual(saved.labelMatchers, entities.map(entity_name => ({ componentId: target.id, labels: { entity_name } })));
      await inspect("saved-entities");
      await editor.getByRole("button", { name: "New address", exact: true }).click();
      await editor.getByRole("button", { name: "Make a new address", exact: true }).click();
      const address = editor.getByRole("textbox", { name: "New Relic address", exact: true });
      await address.waitFor();
      assert.equal(await template.inputValue(), displayedTemplate, "replacement instructions preserve the complete workflow template");
      const destination = await address.inputValue();
      const values = { issueId: `workflow-${width}`, issueTitle: `Private workflow alert ${width}`, "entitiesData.names": [entities[1]] };
      const sendWorkflow = async (state, overrides = {}) => {
        const bindings = { ...values, state, ...overrides };
        const expanded = displayedTemplate.replace(/{{json ([\w.]+)}}/g, (_, binding) => {
          assert.ok(Object.hasOwn(bindings, binding), `controlled workflow value for ${binding}`);
          return JSON.stringify(bindings[binding]);
        });
        const response = await fetch(destination, { method: "POST", headers: { "Content-Type": "application/json" }, body: expanded });
        return { status: response.status, body: await response.json() };
      };
      const unmapped = await sendWorkflow("ACTIVATED", { "entitiesData.names": ["not-an-exact-saved-entity"] });
      assert.equal(unmapped.status, 400); assert.equal(unmapped.body.incidentId, null, "an unmapped entity creates no incident");
      const created = await sendWorkflow("ACTIVATED");
      assert.equal(created.status, 202, JSON.stringify(created.body));
      const opened = (await api(`/api/app/incidents/${created.body.incidentId}`)).body.incident;
      assert.deepEqual(opened.components.map(row => row.componentId), [target.id], "expanded entity binding selects the saved component");
      assert.equal(opened.title, values.issueTitle);
      assert.equal(opened.updates.length, 0, "ACTIVATED creates a private draft only");
      assert.ok(opened.components.every(row => row.publishedAt == null));
      const closed = await sendWorkflow("CLOSED");
      assert.equal(closed.status, 202, JSON.stringify(closed.body));
      assert.equal(closed.body.incidentId, created.body.incidentId, "CLOSED addresses the same workflow incident");
      const resolved = (await api(`/api/app/incidents/${created.body.incidentId}`)).body.incident;
      assert.equal(resolved.lifecycle, "Resolved");
      assert.equal(resolved.updates.length, 0, "workflow recovery publishes no update");
      assert.ok(resolved.components.every(row => row.publishedAt == null));
      const publicText = await (await fetch(`${publicOrigin}/`)).text();
      assert.ok(!publicText.includes(opened.reference) && !publicText.includes(values.issueTitle), "workflow messages remain private");
      await inspect("replacement-and-recovery");
      assert.equal((await api(`/api/app/intake/sources/${connected.id}`, { method: "DELETE" })).status, 200);
    }
    assert.deepEqual(errors, [], "New Relic setup has no page or hydration errors");
    await context.close();
    async function inspect(name) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no page overflow`);
      assert.ok(await editor.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name}: no form overflow`);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) })), [], `${name}: accessibility`);
      if (process.env.LAMP_SCREENSHOTS) await editor.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${page.viewportSize().width}-monitor-${name}.png` });
    }
  } finally { await browser.close(); }
}
