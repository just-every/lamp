import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** Existing Alerts source cards, their exact controls and persisted choices. */
export async function operationsAlertsBrowserFlow({ origin, cookie, component, api }) {
  const target = await component("synthetic-lamp-operations-browser-1");
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split("; ").map(pair => ({ name: pair.slice(0, pair.indexOf("=")), value: pair.slice(pair.indexOf("=") + 1), url: origin })));
    const page = await context.newPage(), hydration = [];
    page.on("pageerror", error => hydration.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /hydrat|did not match|server rendered/i.test(message.text())) hydration.push(message.text()); });
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [tool, label] of [["jsm", "Jira Service Management"], ["opsgenie", "Opsgenie"]]) {
        await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
        await page.getByRole("button", { name: tool === "jsm" ? "JSM Operations" : label, exact: true }).click();
        const editor = page.locator("section.tool-form");
        await editor.getByLabel("Component 1", { exact: true }).selectOption(target.id);
        await editor.getByLabel("Tag 1", { exact: true }).fill("component:api");
        await editor.getByLabel("Entity 1", { exact: true }).fill("synthetic-lamp-entity-1");
        await editor.getByLabel("Close alert on resolve", { exact: true }).check();
        if (tool === "jsm") {
          await editor.getByLabel("Atlassian site", { exact: true }).fill("https://synthetic-lamp-1.atlassian.net");
          await editor.getByLabel("Atlassian account email", { exact: true }).fill("synthetic-lamp-1@example.test");
          await editor.getByLabel("Atlassian API token", { exact: true }).fill("synthetic-lamp-1");
        } else await editor.getByLabel("Opsgenie API key", { exact: true }).fill("synthetic-lamp-2");
        await audit(`${tool}-connect`);
        // The no-credential local connection has no vendor side effect. The
        // recorded edge journey separately exercises sealed credential saves.
        await editor.getByLabel(tool === "jsm" ? "Atlassian API token" : "Opsgenie API key", { exact: true }).fill("");
        await editor.getByRole("button", { name: `Connect ${label}`, exact: true }).click();
        await editor.getByLabel("Authorization header", { exact: true }).waitFor();
        const sourceId = (await editor.getByLabel("Webhook address", { exact: true }).inputValue()).split("/").pop();
        assert.match(await editor.getByLabel("Authorization header", { exact: true }).inputValue(), /^Bearer /);
        await audit(`${tool}-bearer`);
        await editor.getByRole("button", { name: "Done", exact: true }).click();
        await page.reload(); await operatorHydrated(page);
        const source = (await api("/api/app/intake/sources")).body.sources.find(row => row.id === sourceId);
        assert.equal(source.preset, tool); assert.equal(source.closeAlertOnResolve, true);
        assert.deepEqual(source.labelMatchers, [{ componentId: target.id, labels: { tag: "component:api", entity: "synthetic-lamp-entity-1" } }]);
        await page.getByRole("button", { name: `Edit ${source.name}`, exact: true }).click();
        await editor.getByLabel("Close alert on resolve", { exact: true }).waitFor();
        assert.equal(await editor.getByLabel("Close alert on resolve", { exact: true }).isChecked(), true);
        assert.equal(await editor.getByLabel("Tag 1", { exact: true }).inputValue(), "component:api");
        assert.equal(await editor.getByLabel(tool === "jsm" ? "Atlassian API token" : "Opsgenie API key", { exact: true }).inputValue(), "");
        assert.equal(await editor.getByLabel("Entity 1", { exact: true }).inputValue(), "synthetic-lamp-entity-1");
        await editor.getByLabel("Close alert on resolve", { exact: true }).uncheck();
        await editor.locator(".tool-save-state").getByText("Saved", { exact: true }).waitFor();
        const saved = (await api("/api/app/intake/sources")).body.sources.find(row => row.id === sourceId);
        assert.deepEqual(saved.labelMatchers, source.labelMatchers, "choice autosave preserves compound AND matchers");
        assert.equal(saved.closeAlertOnResolve, false, "toggle saves without a Save button");
        await editor.getByLabel("Close alert on resolve", { exact: true }).check();
        await editor.locator(".tool-save-state").getByText("Saved", { exact: true }).waitFor();
        await page.reload(); await operatorHydrated(page);
        await page.getByRole("button", { name: `Edit ${source.name}`, exact: true }).click();
        assert.equal(await editor.getByLabel("Close alert on resolve", { exact: true }).isChecked(), true);
        assert.equal(await editor.getByLabel("Entity 1", { exact: true }).inputValue(), "synthetic-lamp-entity-1");
        await audit(`${tool}-saved`);
        assert.equal((await api(`/api/app/intake/sources/${sourceId}`, { method: "DELETE" })).status, 200);
      }
      await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
      await page.getByRole("button", { name: "New Relic", exact: true }).click();
      const editor = page.locator("section.tool-form");
      await editor.getByRole("combobox", { name: "Component", exact: true }).selectOption(target.id);
      await editor.getByRole("button", { name: "Connect New Relic", exact: true }).click();
      const template = editor.getByRole("textbox", { name: "New Relic workflow template", exact: true });
      await template.waitFor(); assert.match(await template.inputValue(), /{{json issueId}}/); assert.match(await template.inputValue(), /{{json state}}/);
      await audit("newrelic-template");
      const newRelic = (await api("/api/app/intake/sources")).body.sources.find(row => row.preset === "newrelic");
      assert.ok(newRelic); assert.equal((await api(`/api/app/intake/sources/${newRelic.id}`, { method: "DELETE" })).status, 200);
    }
    assert.deepEqual(hydration, [], "no hydration mismatch on changed source forms");
    await context.close();
    async function audit(name) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal overflow`);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(results.violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${name}: no serious/critical axe findings`);
      if (process.env.LAMP_SCREENSHOTS) await page.locator("section.tool-form").screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${page.viewportSize().width}-${name}.png` });
    }
  } finally { await browser.close(); }
}
