import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";

export async function subscriberReportingBrowserFlow({ page, appUrl, appFetch }) {
  const previousViewport = page.viewportSize();
  const proof = process.env.LAMP_SCREENSHOTS;
  if (proof) await mkdir(proof, { recursive: true });
  const componentResponse = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ name: "Reporting checkout API", description: "Card payments and order confirmation.", groupId: null, internal: false, displayOrder: 1002, note: "" }) });
  assert.equal(componentResponse.status, 201);
  const { component } = await componentResponse.json();
  const selected = await appFetch("/api/app/subscribers/webhook", { method: "POST", body: JSON.stringify({ destination: "https://noc.acme.example/hooks/payments", contactEmail: "noc@acme.example", componentIds: [component.id] }) });
  assert.equal(selected.status, 201);
  for (const width of [1440, 390]) {
    const before = await (await appFetch("/api/app/subscriber-reporting")).json();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1600 });
    await page.goto(`${appUrl}/app/subscribers`); await operatorHydrated(page);
    const panel = page.getByRole("region", { name: "Subscriber reporting", exact: true });
    await panel.getByText(`${before.total} current subscribers`, { exact: true }).waitFor();
    const endpoint = `https://noc.acme.example/hooks/fulfilment-${width}`;
    await page.getByLabel("Endpoint URL", { exact: true }).fill(endpoint);
    await page.getByLabel("Contact email", { exact: true }).fill("fulfilment@acme.example");
    await page.getByRole("button", { name: "Add webhook", exact: true }).click();
    await panel.getByText(`${before.total + 1} current subscribers`, { exact: true }).waitFor();
    await panel.getByText("Counts by component", { exact: true }).click();
    await panel.getByRole("region", { name: "Subscriber counts by component", exact: true }).getByText(component.name, { exact: true }).first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const axe = await new AxeBuilder({ page }).include(".subscriber-reporting").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), []);
    if (proof) await panel.screenshot({ path: `${proof}/${width}-subscriber-report.png` });
    await panel.getByRole("combobox", { name: "Channel", exact: true }).selectOption("webhook");
    const webhookOnly = await (await appFetch("/api/app/subscriber-reporting?channel=webhook")).json();
    await panel.getByText(`${webhookOnly.total} current subscribers`, { exact: true }).waitFor();
    const downloaded = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Download CSV", exact: true }).click();
    const download = await downloaded;
    assert.equal(await download.failure(), null);
    const stream = await download.createReadStream(); let csv = "";
    for await (const chunk of stream) csv += chunk;
    assert.ok(csv.includes("webhook") && !csv.includes(endpoint), "aggregate export contains counts without destinations");
    await panel.getByLabel("Growth month (UTC)").fill("2001-01");
    await panel.getByText("No observed days in this range. Historical changes before tracking are unknown.", { exact: true }).waitFor();
    if (proof) await panel.screenshot({ path: `${proof}/${width}-subscriber-unknown-history.png` });
    // Removing through the product also refreshes the report, excluding its
    // erased tombstone while preserving the anonymous departure count.
    const row = page.getByRole("row").filter({ hasText: endpoint });
    page.once("dialog", dialog => dialog.accept());
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await panel.getByText(`${webhookOnly.total - 1} current subscribers`, { exact: true }).waitFor();
    assert.equal(await panel.getByLabel("Growth month (UTC)").inputValue(), "2001-01");
    assert.equal(await panel.getByRole("combobox", { name: "Channel", exact: true }).inputValue(), "webhook");
  }
  await page.setViewportSize(previousViewport);
}
