import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";

export async function postIncidentReportFlow({ page, appFetch, appUrl, pageUrl }) {
  const api = async (path, method, body) => {
    const response = await appFetch(path, { method, body: JSON.stringify(body) });
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
    return response.json();
  };
  const { component } = await api("/api/app/components", "POST", { groupId: null, name: "Payments API", description: "Payment processing for Atlas Cloud customers.", internal: false, displayOrder: 1, note: "" });
  const { incident } = await api("/api/app/incidents", "POST", { title: "Payment requests timed out", components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
  await api(`/api/app/incidents/${incident.id}/draft`, "PUT", { lifecycle: "Resolved", affectedAudience: "Customers submitting card payments.", customerImpact: "Payment processing has recovered. Timed-out requests can be retried safely.", whatStillWorks: "Account access and existing payment records remained available.", details: "We verified recovery after restoring database capacity.", nextUpdateAt: null });
  await api(`/api/app/incidents/${incident.id}/publish`, "POST", { channels: [] });
  const endpoint = `/api/app/incidents/${incident.id}/report`;
  const report = {
    summary: "Payment requests timed out for 18 minutes. Service is fully restored and no payment records were lost.",
    timeline: "09:12 UTC: elevated timeouts detected. 09:18: connection limit identified. 09:25: capacity restored. 09:30: recovery verified.",
    cause: "A database connection pool reached its limit during the morning payment peak.",
    remediation: "Raised connection capacity, added pool saturation alerts, and scheduled a peak-traffic load exercise.",
  };
  const editor = page.locator("section").filter({ has: page.getByRole("heading", { name: "Post-incident report", exact: true }) });
  const capture = async (target, state) => {
    if (!process.env.LAMP_REPORT_SCREENSHOTS) return;
    await mkdir(process.env.LAMP_REPORT_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await target.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${state} fits ${width}px`);
      await page.screenshot({ path: join(process.env.LAMP_REPORT_SCREENSHOTS, `saved-report-${state}-${width}.png`), fullPage: true });
    }
  };
  const save = async () => {
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === "PUT");
    await editor.getByRole("button", { name: "Save report", exact: true }).click();
    const response = await saved;
    assert.equal(response.status(), 200, await response.text());
    await editor.getByRole("status").waitFor();
  };
  const assertFields = async () => {
    for (const [field, value] of Object.entries(report)) {
      const input = editor.getByLabel(field, { exact: false });
      await expect(input).toHaveValue(value);
    }
  };

  await page.goto(`${appUrl}/app/incidents/${incident.id}`);
  await editor.getByLabel("Summary", { exact: true }).waitFor();
  for (const [field, value] of Object.entries(report)) await editor.getByLabel(field, { exact: false }).fill(value);
  await save();
  await page.reload();
  await assertFields();
  report.cause += " The pool had not been resized after the latest traffic increase.";
  await editor.getByLabel("Cause").fill(report.cause);
  await save();
  await page.reload();
  await assertFields();
  await capture(editor, "draft");

  const publicDraft = await fetch(`${pageUrl}/incidents/${incident.reference}`);
  assert.equal(publicDraft.status, 200);
  assert.equal((await publicDraft.text()).includes(report.summary), false, "saved drafts stay private");
  const publishing = page.waitForResponse(response => new URL(response.url()).pathname === `${endpoint}/publish` && response.request().method() === "POST");
  await editor.getByRole("button", { name: "Publish report", exact: true }).click();
  const published = await publishing;
  assert.equal(published.status(), 200, await published.text());
  await page.reload();
  await editor.getByText(/^Published /).waitFor();
  assert.equal(await editor.getByRole("button", { name: "Save report", exact: true }).count(), 0, "published reports are immutable");
  await capture(editor, "published-operator");

  await page.goto(`${pageUrl}/incidents/${incident.reference}`);
  await page.getByText(report.summary, { exact: true }).waitFor();
  for (const value of Object.values(report)) assert.ok((await page.locator("body").innerText()).includes(value));
  await capture(page.locator("body"), "published");
}
