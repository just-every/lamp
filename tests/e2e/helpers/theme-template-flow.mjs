import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

/** The existing theme journey follows the same saved theme through each shipped layout. */
export async function themeTemplateFlow({ appFetch, pageUrl, updateSettings, snapshot, palette }) {
  const components = (await (await appFetch("/api/app/components")).json()).components;
  const chosen = components.filter(component => ["Web application", "API gateway"].includes(component.name));
  const edit = async (component, region) => {
    const response = await appFetch(`/api/app/components/${component.id}`, { method: "PUT", body: JSON.stringify({ groupId: component.groupId, name: component.name, description: component.description, internal: component.internal, displayOrder: component.displayOrder, note: component.note, region }) });
    assert.equal(response.status, 200);
  };
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    for (const [index, component] of chosen.entries()) await edit(component, index ? "Europe" : "North America");
    const page = await browser.newPage();
    for (const template of ["calm", "uptime", "regions"]) {
      await updateSettings({ template });
      await snapshot(`data-template="${template}"`);
      await page.goto(`${pageUrl}/`, { waitUntil: "networkidle" });
      await expect(page.locator(".theme-header")).toContainText("Service updates from the Atlas team.");
      await expect(page.locator(".theme-footer")).toContainText("Always here to help.");
      assert.equal(await page.locator(".owner-note").evaluate(element => getComputedStyle(element).letterSpacing), "0.4px");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({ path: `test-results/theme-001/${template}-${width}.png`, fullPage: true });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${template} fits ${width}`);
        const group = page.locator("details.theme-component-group").first();
        assert.equal(await group.getAttribute("open"), null);
        await expect(group).toBeVisible();
        const contents = group.locator(":scope > :not(summary)").first();
        await expect(contents).toBeHidden();
        await group.locator(":scope > summary").click();
        await expect(contents).toBeVisible();
        if (template === "uptime" && width === 1440) {
          const expected = palette.surface.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16)).join(", ");
          assert.equal(await group.locator(".hm-frame").evaluate(element => getComputedStyle(element).backgroundColor), `rgb(${expected})`);
        }
        const component = group.locator("details.rg-row").filter({ hasText: "API gateway" });
        if (template === "regions") await component.locator(":scope > summary").click();
        const record = page.getByRole("list", { name: "14-day uptime record for API gateway", exact: true });
        await expect(record.getByRole("listitem")).toHaveCount(14);
        await expect(page.getByRole("list", { name: "14-day uptime record for Web application", exact: true }).getByRole("listitem")).toHaveCount(0);
        await page.screenshot({ path: `test-results/theme-001/${template}-expanded-${width}.png`, fullPage: true });
        if (template === "regions") await component.locator(":scope > summary").click();
        await group.locator(":scope > summary").click();
      }
    }
    await page.close();
  } finally {
    await browser.close();
    for (const component of chosen) await edit(component, component.region ?? null);
  }
}
