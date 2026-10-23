import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** Reuse an existing maintenance registration: the real form creates and
 * reschedules window-owned choices, then starts an opted-out window by hand. */
export async function maintenanceAutomationFlow({ page, origin, component, api, diagnostic = () => {} }) {
  const originalViewport = page.viewportSize();
  const screenshots = process.env.LAMP_SCREENSHOTS;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  async function capture(name, width) {
    if (screenshots) await page.screenshot({ path: join(screenshots, `${name}-${width}.png`), fullPage: true });
  }
  const hydrationErrors = [];
  const observeConsole = message => { if (/hydration|did not match|server rendered/i.test(message.text())) hydrationErrors.push(message.text()); };
  const observePageError = error => { if (/hydration|did not match|server rendered/i.test(error.message)) hydrationErrors.push(error.message); };
  page.on("console", observeConsole); page.on("pageerror", observePageError);
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
      await page.goto(`${origin}/app/settings#writing`); await operatorHydrated(page);
      const defaults = page.getByRole("region", { name: "Maintenance automation", exact: true });
      const defaultStart = defaults.getByRole("checkbox", { name: "Auto-start maintenance", exact: true });
      const defaultComplete = defaults.getByRole("checkbox", { name: "Auto-complete maintenance", exact: true });
      await expect(defaultStart).toBeChecked(); await expect(defaultComplete).toBeChecked();
      async function changeDefault(control, expected) {
        const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/maintenance/automation" && response.request().method() === "PUT");
        await control.setChecked(expected);
        const response = await saved;
        assert.equal(response.status(), 200);
        await expect(defaults.getByRole("status")).toHaveText("Saved");
      }
      await changeDefault(defaultStart, false); await changeDefault(defaultComplete, false);
      await page.reload(); await operatorHydrated(page);
      await expect(defaultStart).not.toBeChecked(); await expect(defaultComplete).not.toBeChecked();
      await capture("maintenance-automation-settings", width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px automation Settings card has no horizontal overflow`);
      const settingsAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(settingsAxe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) })), []);
      await page.goto(`${origin}/app/maintenance`); await operatorHydrated(page);
      const defaultsForm = page.locator(".maintenance-schedule-card");
      await expect(defaultsForm.getByRole("checkbox", { name: "Auto-start maintenance", exact: true })).not.toBeChecked();
      await expect(defaultsForm.getByRole("checkbox", { name: "Auto-complete maintenance", exact: true })).not.toBeChecked();
      await capture("maintenance-automation-new-window", width);
      const inherited = (await api("/api/app/maintenance", "POST", { title: `synthetic-lamp-${9000 + width}`, startsAt: "2027-08-16T10:00:00.000Z", endsAt: "2027-08-16T11:00:00.000Z", componentIds: [component.id] })).maintenance;
      assert.equal(inherited.autoStart, false); assert.equal(inherited.autoComplete, false);
      await page.goto(`${origin}/app/settings#writing`); await operatorHydrated(page);
      await changeDefault(defaultStart, true); await changeDefault(defaultComplete, true);
      await page.reload(); await operatorHydrated(page);
      await expect(defaultStart).toBeChecked(); await expect(defaultComplete).toBeChecked();
      const retained = (await api("/api/app/maintenance")).maintenance.find(row => row.id === inherited.id);
      assert.equal(retained.autoStart, false); assert.equal(retained.autoComplete, false, "changing page defaults never changes an existing window");
      const invalid = await page.request.put(`${origin}/api/app/maintenance/automation`, { headers: { Origin: origin }, data: { autoStart: "false", autoComplete: true } });
      assert.equal(invalid.status(), 400);
      await api(`/api/app/maintenance/${inherited.id}/cancel`, "POST");
      await page.goto(`${origin}/app/maintenance`); await operatorHydrated(page);
      const create = page.locator(".maintenance-schedule-card");
      const startChoice = create.getByRole("checkbox", { name: "Auto-start maintenance", exact: true });
      const completeChoice = create.getByRole("checkbox", { name: "Auto-complete maintenance", exact: true });
      await expect(startChoice).toBeChecked(); await expect(completeChoice).toBeChecked();
      await create.getByLabel("Title", { exact: true }).fill(`synthetic-lamp-009-${width}`);
      await create.getByLabel(component.name, { exact: true }).check();
      await create.getByLabel("Starts", { exact: true }).fill("2027-08-15T10:00");
      await create.getByLabel("Ends", { exact: true }).fill("2027-08-15T11:00");
      await startChoice.uncheck(); await completeChoice.uncheck();
      const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/maintenance" && response.request().method() === "POST");
      await create.getByRole("button", { name: "Schedule window", exact: true }).click();
      const creation = await created;
      assert.equal(creation.status(), 201);
      const { maintenance } = await creation.json();
      assert.equal(maintenance.autoStart, false); assert.equal(maintenance.autoComplete, false);
      const row = page.locator(".maintenance-row").filter({ hasText: maintenance.reference });
      async function openEditor() {
        await page.reload(); await operatorHydrated(page);
        await row.getByText("Change dates", { exact: true }).click();
        await row.getByRole("checkbox", { name: "Auto-start maintenance", exact: true }).waitFor();
      }
      const rowStart = row.getByRole("checkbox", { name: "Auto-start maintenance", exact: true });
      const rowComplete = row.getByRole("checkbox", { name: "Auto-complete maintenance", exact: true });
      async function save(expectedStart, expectedComplete) {
        const changed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/maintenance/${maintenance.id}/window` && response.request().method() === "PUT");
        await row.getByRole("button", { name: "Reschedule", exact: true }).click();
        const response = await changed;
        assert.equal(response.status(), 200);
        const persisted = (await response.json()).maintenance;
        assert.equal(persisted.autoStart, expectedStart); assert.equal(persisted.autoComplete, expectedComplete);
        await openEditor();
        assert.equal(await rowStart.isChecked(), expectedStart); assert.equal(await rowComplete.isChecked(), expectedComplete);
      }
      await openEditor();
      await expect(rowStart).not.toBeChecked(); await expect(rowComplete).not.toBeChecked();
      await expect(row.getByRole("button", { name: "Start maintenance", exact: true })).toBeVisible();
      await rowStart.check(); await rowComplete.check(); await save(true, true);
      assert.equal(await row.getByRole("button", { name: "Start maintenance", exact: true }).count(), 0, "automatic windows need no manual-start control");
      await rowStart.uncheck(); await save(false, true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px automation forms have no horizontal overflow`);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) })), []);
      const started = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/maintenance/${maintenance.id}/start` && response.request().method() === "POST");
      await row.getByRole("button", { name: "Start maintenance", exact: true }).click();
      const start = await started;
      assert.equal(start.status(), 200);
      assert.equal((await start.json()).maintenance.state, "In progress");
      await expect(row.locator(".state-pill")).toHaveText("In progress");
      assert.equal(await row.getByRole("button", { name: "Start maintenance", exact: true }).count(), 0);
      await row.getByText("Extend window", { exact: true }).click();
      const runningComplete = row.getByRole("checkbox", { name: "Auto-complete maintenance", exact: true });
      await expect(runningComplete).toBeChecked();
      await runningComplete.uncheck();
      const flagsSaved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/maintenance/${maintenance.id}/window` && response.request().method() === "PUT");
      await row.getByRole("button", { name: "Save automation", exact: true }).click();
      const flagsResponse = await flagsSaved;
      assert.equal(flagsResponse.status(), 200);
      assert.equal((await flagsResponse.json()).maintenance.autoComplete, false, "an active window saves automation without extending its end");
      await page.reload(); await operatorHydrated(page);
      await row.getByText("Extend window", { exact: true }).click();
      await expect(row.getByRole("checkbox", { name: "Auto-complete maintenance", exact: true })).not.toBeChecked();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px active automation control has no horizontal overflow`);
      const activeAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(activeAxe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) })), []);
      await api(`/api/app/maintenance/${maintenance.id}/complete`, "POST");
      diagnostic(`MAINT-009 ${width}px: Settings defaults saved and reloaded, inherited by new API and form windows without changing existing windows, default-on create controls, persisted false/false, rescheduled true/true and false/true, manual start, active-window flag-only update, full-page axe, no overflow and hydration proof passed`);
    }
    assert.deepEqual(hydrationErrors, []);
  } finally {
    page.off("console", observeConsole); page.off("pageerror", observePageError);
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
