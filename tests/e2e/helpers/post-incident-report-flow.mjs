import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { operatorHydrated } from "./operator-hydrated.mjs";

export async function postIncidentReportFlow({ page, appFetch, appUrl, pageUrl }) {
  const api = async (path, method, body) => {
    const response = await appFetch(path, { method, body: JSON.stringify(body) });
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
    return response.json();
  };
  const { component } = await api("/api/app/components", "POST", { groupId: null, name: "Payments API", description: "Payment processing for Atlas Cloud customers.", internal: false, displayOrder: 1, note: "" });
  const { source } = await api("/api/app/intake/sources", "POST", { name: "Payment report evidence", credentialKind: "hmac-sha256", signingSecret: "browser-report-secret", deduplicationPath: "$.alert.id", titlePath: "$.alert.title", statePath: "$.alert.state", recoveredValue: "recovered" });
  const alert = async (state) => {
    const body = JSON.stringify({ alert: { id: "payment-report", title: `Payment timeout ${state}`, state } });
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", "browser-report-secret").update(`${timestamp}.${body}`).digest("base64url");
    const response = await fetch(`${pageUrl}/api/intake/${source.id}`, { method: "POST", headers: { "Content-Type": "application/json", "x-lamp-timestamp": timestamp, "x-lamp-signature": signature }, body });
    assert.equal(response.status, 202, await response.clone().text());
    return response.json();
  };
  const accepted = await alert("firing");
  const { incident } = await api(`/api/app/incidents/${accepted.incidentId}`, "GET");
  await api(`/api/app/incidents/${incident.id}/components`, "POST", { componentId: component.id, state: "Major outage", relationship: "Primary" });
  const update = { lifecycle: "Investigating", affectedAudience: "Customers submitting card payments.", customerImpact: "Payment requests are timing out.", whatStillWorks: "Account access and existing payment records remain available.", details: "We are investigating database capacity.", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() };
  await api(`/api/app/incidents/${incident.id}/draft`, "PUT", update);
  await api(`/api/app/incidents/${incident.id}/publish`, "POST", { channels: [] });
  await page.goto(`${appUrl}/app/incidents/${incident.id}`);
  await operatorHydrated(page);
  assert.equal(await page.getByRole("button", { name: "Draft report", exact: true }).count(), 0, "reports are offered only after resolution");
  await alert("recovered");
  await api(`/api/app/incidents/${incident.id}/draft`, "PUT", { ...update, lifecycle: "Resolved", customerImpact: "Payment processing has recovered. Timed-out requests can be retried safely.", details: "We verified recovery after restoring database capacity.", nextUpdateAt: null });
  await api(`/api/app/incidents/${incident.id}/publish`, "POST", { channels: [], overrideReason: "Operator verified payment recovery; proceed before the monitor hold expires." });
  const endpoint = `/api/app/incidents/${incident.id}/report`;
  const report = {
    summary: "",
    timeline: "",
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
  await operatorHydrated(page);
  await editor.getByLabel("Summary", { exact: true }).waitFor();
  const drafting = page.waitForResponse(response => new URL(response.url()).pathname === `${endpoint}/draft` && response.request().method() === "POST");
  await editor.getByRole("button", { name: "Draft report", exact: true }).click();
  const drafted = await drafting;
  assert.equal(drafted.status(), 200, await drafted.text());
  const generated = await drafted.json();
  report.summary = generated.report.summary; report.timeline = generated.report.timeline;
  await expect(editor.getByLabel("Summary", { exact: true })).toHaveValue(report.summary);
  await expect(editor.getByLabel("Cause", { exact: true })).toHaveValue("");
  await expect(editor.getByLabel("Remediation", { exact: true })).toHaveValue("");
  await expect(editor.locator("textarea[aria-describedby]")).toHaveCount(2);
  await expect(editor.getByRole("button", { name: "Draft report", exact: true })).toBeDisabled();
  const { brief } = await api(`/api/app/incidents/${incident.id}/brief`, "GET");
  const refs = new Set([...brief.whatWeKnow.alerts, ...brief.whatWeKnow.updates].map((item) => item.ref));
  for (const line of report.timeline.split("\n")) assert.ok(refs.has(line.match(/\[(A\d+|U\d+)\]$/)?.[1]), "each generated timeline line cites the incident brief");
  const incompletePublish = page.waitForResponse(response => new URL(response.url()).pathname === `${endpoint}/publish` && response.request().method() === "POST");
  await editor.getByRole("button", { name: "Publish report", exact: true }).click();
  assert.equal((await incompletePublish).status(), 400, "the untouched report requires human cause and remediation");
  await capture(editor, "generated");
  for (const [field, value] of Object.entries(report)) await editor.getByLabel(field, { exact: false }).fill(value);
  await save();
  await page.reload();
  await operatorHydrated(page);
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
