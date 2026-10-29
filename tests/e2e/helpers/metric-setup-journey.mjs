import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** The six public metric feeds are configured through the component's panel. */
export async function metricSetupJourney({ api, post, component, origin, cookie }) {
  const target = await component("Metric-monitored API");
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.LAMP_CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookie.split("; ").map(pair => ({ name: pair.slice(0, pair.indexOf("=")), value: pair.slice(pair.indexOf("=") + 1), url: origin })));
    const page = await context.newPage(), errors = [], secrets = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /hydrat|did not match|server rendered/i.test(message.text())) errors.push(message.text()); });
    if (process.env.LAMP_SCREENSHOTS) await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    const list = async () => {
      const result = await api(`/api/app/metrics?componentId=${target.id}`);
      assert.equal(result.status, 200, result.text);
      for (const secret of secrets) assert.ok(!result.text.includes(secret), "metric listings never return sealed query keys");
      return result.body.metrics;
    };
    const panelOf = dialog => dialog.getByRole("region", { name: "Public performance metrics", exact: true });
    async function openComponent() {
      await page.goto(`${origin}/app/components`); await operatorHydrated(page);
      await page.locator("article.component-row").filter({ has: page.getByText(target.name, { exact: true }) }).getByRole("button", { name: "Edit component", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: target.name, exact: true });
      await panelOf(dialog).getByRole("button", { name: "Add metric", exact: true }).waitFor();
      return dialog;
    }
    async function closeComponent(dialog) {
      await dialog.getByRole("button", { name: "Close component panel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    const feeds = [
      { provider: "push", query: "" },
      { provider: "datadog", query: "avg:synthetic.metric{*}" },
      { provider: "newrelic", query: "SELECT average(duration) AS value FROM Transaction", accountId: "123" },
      { provider: "pingdom", query: "123" },
      { provider: "uptime", query: "metric-monitor" },
      { provider: "prometheus", query: "avg(synthetic_latency)", endpoint: "https://metrics.example.test" },
    ];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const feed of feeds) {
        const { provider, query } = feed;
        let source = null;
        if (!["push", "prometheus"].includes(provider)) {
          const made = await post("/api/app/intake/sources", { name: `${provider} metric source ${width}`, preset: provider, credentialKind: "bearer-token",
            ...(provider === "uptime" ? { monitorMappings: [{ monitorId: query, componentId: target.id }] } : { componentId: target.id }) });
          assert.equal(made.status, 201, made.text); source = made.body.source;
        }
        let dialog = await openComponent(), panel = panelOf(dialog);
        await panel.getByRole("button", { name: "Add metric", exact: true }).click();
        const form = panel.getByRole("form", { name: "Add public metric", exact: true });
        await form.getByLabel("Metric feed", { exact: true }).selectOption(provider === "uptime" ? `${source.id}/${query}` : source?.id ?? provider);
        const name = `${provider} latency ${width}`;
        await form.getByLabel("Metric name", { exact: true }).fill(name);
        if (!["push", "uptime"].includes(provider)) await form.getByLabel(provider === "pingdom" ? "Pingdom check ID" : "Metric query", { exact: true }).fill(query);
        if (provider === "newrelic") {
          await form.getByLabel("New Relic account ID", { exact: true }).fill(feed.accountId);
          await form.getByLabel("Unit", { exact: true }).fill("s");
        }
        if (provider === "prometheus") await form.getByLabel("Prometheus endpoint", { exact: true }).fill(feed.endpoint);
        await inspect(`${provider}-feed`, form);
        await form.getByRole("button", { name: "Add metric", exact: true }).click();
        let editor = panel.getByRole("region", { name: `Edit metric ${name}`, exact: true });
        await editor.getByLabel("Metric name", { exact: true }).waitFor();
        const metric = (await list()).find(row => row.name === name);
        assert.ok(metric);
        assert.equal(metric.connected, ["push", "uptime"].includes(provider), "only direct feeds are connected before saving a provider key");
        const needsKey = !["push", "uptime"].includes(provider);
        const keyLabel = provider === "datadog" ? "Datadog API key" : "Read-only API key";
        if (needsKey) {
          const key = `synthetic-${provider}-read-key-${width}`;
          secrets.push(key); await editor.getByLabel(keyLabel, { exact: true }).fill(key);
          if (provider === "datadog") {
            const applicationKey = `synthetic-datadog-application-key-${width}`;
            secrets.push(applicationKey); await editor.getByLabel("Read-only application key", { exact: true }).fill(applicationKey);
          }
          await editor.getByRole("button", { name: "Save read-only key", exact: true }).click();
          await editor.getByText("Read-only key connected.", { exact: false }).waitFor();
          assert.equal(await editor.getByLabel(keyLabel, { exact: true }).inputValue(), "", "saving clears the query key from the form");
          if (provider === "datadog") assert.equal(await editor.getByLabel("Read-only application key", { exact: true }).inputValue(), "", "saving clears the application key from the form");
        }
        if (provider === "push") {
          const refused = await fetch(`${origin}/api/v1/metrics/${metric.id}/points`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: [{ at: Math.floor(Date.now() / 60_000) * 60_000, value: 999 }] }) });
          assert.equal(refused.status, 401, "the native versioned push door refuses an anonymous request");
          await refused.body?.cancel();
          assert.equal(await editor.getByLabel("Metric push address", { exact: true }).inputValue(), `/api/app/metrics/${metric.id}/points`);
        }
        await editor.locator(".tool-note").last().scrollIntoViewIfNeeded();
        await inspect(`${provider}-configured`, dialog);
        const editedName = `${name} edited`;
        await editor.getByLabel("Metric name", { exact: true }).fill(editedName);
        await closeComponent(dialog);
        assert.equal((await list()).find(row => row.id === metric.id).name, editedName, "closing the panel flushes its metric autosave");
        await page.reload(); await operatorHydrated(page);
        dialog = await openComponent(); panel = panelOf(dialog);
        await panel.getByRole("button", { name: "Edit metric", exact: true }).click();
        editor = panel.getByRole("region", { name: `Edit metric ${editedName}`, exact: true });
        assert.equal(await editor.getByLabel("Metric name", { exact: true }).inputValue(), editedName);
        const saved = (await list()).find(row => row.id === metric.id);
        assert.equal(saved.connected, true, `${provider}: the connection survives reload`);
        assert.equal(saved.provider, provider); assert.equal(saved.sourceId, source?.id ?? null); assert.equal(saved.query, query);
        if (needsKey) assert.equal(await editor.getByLabel(provider === "pingdom" ? "Pingdom check ID" : "Metric query", { exact: true }).inputValue(), query);
        if (feed.accountId) {
          assert.equal(saved.accountId, feed.accountId);
          assert.equal(await editor.getByLabel("New Relic account ID", { exact: true }).inputValue(), feed.accountId);
        }
        if (feed.endpoint) {
          assert.equal(saved.endpoint, feed.endpoint);
          assert.equal(await editor.getByLabel("Prometheus endpoint", { exact: true }).inputValue(), feed.endpoint);
        }
        if (needsKey) assert.equal(await editor.getByLabel(keyLabel, { exact: true }).inputValue(), "", "sealed query keys are never reloaded into the form");
        if (provider === "datadog") assert.equal(await editor.getByLabel("Read-only application key", { exact: true }).inputValue(), "", "the sealed application key is never reloaded");
        await inspect(`${provider}-saved`, dialog);
        await closeComponent(dialog);
        if (source) {
          assert.equal((await api(`/api/app/intake/sources/${source.id}`, { method: "DELETE" })).status, 200);
          assert.ok(!(await list()).some(row => row.sourceId === source.id), "removing a source removes its metric connection");
        } else assert.equal((await api(`/api/app/metrics/${metric.id}`, { method: "DELETE" })).status, 200);
      }
    }
    assert.deepEqual(errors, [], "metric setup has no page or hydration errors");
    await context.close();
    async function inspect(name, scope) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no page overflow`);
      assert.ok(await scope.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name}: no panel overflow`);
      assert.deepEqual(await scope.locator("button").evaluateAll(buttons => buttons.filter(button => button.scrollWidth > button.clientWidth + 1).map(button => button.textContent.trim())), [], `${name}: control labels are unclipped`);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) })), [], `${name}: accessibility`);
      if (process.env.LAMP_SCREENSHOTS) await scope.screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${page.viewportSize().width}-metrics-${name}.png` });
    }
  } finally { await browser.close(); }
}
