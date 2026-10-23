import assert from "node:assert/strict";
import { AxeBuilder } from "@axe-core/playwright";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** Shared browser proof inside an existing owner/reminders registration. The
 * caller supplies real signed-in operator sessions and incidents from public doors. */
export async function communicationOwnerFlow({ page, appUrl, incident, unownedIncident, previousOwner, currentOwner, request }) {
  const originalViewport = page.viewportSize();
  const hydrationErrors = [];
  const observeError = message => { if (/hydration|did not match|server rendered/i.test(message.text())) hydrationErrors.push(message.text()); };
  const observePageError = error => { if (/hydration|did not match|server rendered/i.test(error.message)) hydrationErrors.push(error.message); };
  page.on("console", observeError);
  page.on("pageerror", observePageError);
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
      // Leave the fixture unowned until both widths have checked Overview.
      await page.goto(`${appUrl}/app`); await operatorHydrated(page);
      const row = page.getByRole("link").filter({ hasText: `${unownedIncident.reference} · ${unownedIncident.title}` });
      await row.getByText("· Unowned", { exact: true }).waitFor();
      await page.goto(`${appUrl}/app/incidents/${unownedIncident.id}`); await operatorHydrated(page);
      const unowned = page.getByRole("region", { name: "Communication owner", exact: true });
      await unowned.getByText("Unowned — an active operator needs to take over.", { exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px unowned document has no horizontal overflow`);
      let axe = await new AxeBuilder({ page }).include('[aria-label="Communication owner"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), []);

      // Reset through the same owner door, so each viewport exercises takeover
      // from a different active operator, then reassignment back to them.
      await request(`/api/app/incidents/${incident.id}/owner`, "PUT", { operatorId: previousOwner.id });
      await page.goto(`${appUrl}/app/incidents/${incident.id}`); await operatorHydrated(page);
      const panel = page.getByRole("region", { name: "Communication owner", exact: true });
      await panel.locator("p strong").filter({ hasText: previousOwner.displayName }).waitFor();
      await panel.getByRole("button", { name: "Take over communication", exact: true }).click();
      await panel.locator("p strong").filter({ hasText: currentOwner.displayName }).waitFor();
      await panel.getByLabel("Reassign communication owner", { exact: true }).selectOption(previousOwner.id);
      await panel.getByRole("button", { name: "Reassign owner", exact: true }).click();
      await panel.locator("p strong").filter({ hasText: previousOwner.displayName }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px owner controls have no horizontal overflow`);
      axe = await new AxeBuilder({ page }).include('[aria-label="Communication owner"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), []);
    }
    assert.deepEqual(hydrationErrors, []);
  } finally {
    page.off("console", observeError);
    page.off("pageerror", observePageError);
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
