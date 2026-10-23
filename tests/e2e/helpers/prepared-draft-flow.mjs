import assert from "node:assert/strict";
import { AxeBuilder } from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** Inside an existing registration, inspect the deterministic prepared draft
 * without publishing or editing it. The caller authenticates its own context. */
export async function preparedDraftFlow({ page, appUrl, incident, draft }) {
  const preparation = draft.agentPreparation;
  assert.equal(preparation?.preparedBy, "Lamp");
  const response = await page.request.get(`${appUrl}/api/app/incidents/${incident.id}/brief`);
  assert.equal(response.status(), 200);
  const { brief } = await response.json();
  const refs = new Set([...brief.whatWeKnow.alerts, ...brief.whatWeKnow.updates, ...brief.whatWeKnow.components, ...brief.whatWeDoNotKnowYet].map(item => item.ref));
  for (const ref of preparation.citations) assert.ok(refs.has(ref), `prepared source ${ref} resolves in the incident brief`);
  const originalViewport = page.viewportSize();
  const hydrationErrors = [];
  const observeConsole = message => { if (/hydration|did not match|server rendered/i.test(message.text())) hydrationErrors.push(message.text()); };
  const observePageError = error => { if (/hydration|did not match|server rendered/i.test(error.message)) hydrationErrors.push(error.message); };
  page.on("console", observeConsole); page.on("pageerror", observePageError);
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
      await page.goto(`${appUrl}/app/incidents/${incident.id}#prepared-draft`); await operatorHydrated(page);
      const panel = page.getByRole("region", { name: "Lamp-prepared draft", exact: true });
      await panel.getByRole("heading", { name: "Prepared by Lamp", exact: true }).waitFor();
      // The editable composer retains every drafted wording field. The private
      // provenance panel retains the full evidence text, without field limits.
      await expect(page.getByLabel("What’s happening?", { exact: true })).toHaveValue(draft.customerImpact);
      await expect(page.getByLabel("Who is affected", { exact: true })).toHaveValue(draft.affectedAudience);
      for (const item of preparation.evidence) assert.ok((await panel.innerText()).includes(item.text), `${item.ref} evidence remains complete in the private composer`);
      if (preparation.noEvidenceChange) await panel.getByText("No new evidence has been recorded since the last published update.", { exact: true }).waitFor();
      for (const ref of preparation.citations) {
        const link = panel.getByRole("link", { name: `[${ref}]`, exact: true }).last();
        assert.equal(await link.getAttribute("href"), `#brief-${ref}`);
        await link.click();
        await expect(page.locator(`#brief-${ref}`)).toBeVisible();
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px prepared draft has no horizontal overflow`);
      const axe = await new AxeBuilder({ page }).include("#prepared-draft").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(axe.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), []);
    }
    assert.deepEqual(hydrationErrors, []);
  } finally {
    page.off("console", observeConsole); page.off("pageerror", observePageError);
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
