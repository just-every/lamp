import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

export async function themeBrowserFlow({ appUrl, pageUrl, sessionId, cookieName, theme, image, font, currentSettings, snapshot }) {
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  const directory = "test-results/theme-001";
  await mkdir(directory, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: cookieName, value: sessionId, url: appUrl }]);
    const page = await context.newPage();
    await page.goto(`${appUrl}/app/settings`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Theme", exact: true })).toBeVisible();
    const open = async title => { const detail = page.locator("details").filter({ has: page.locator(":scope > summary", { hasText: title }) }).first(); if (!await detail.getAttribute("open")) await detail.locator(":scope > summary").click(); };
    await open("Colours");
    await page.getByLabel("Use a custom colour palette").check();
    const labels = { background: "Background", surface: "Surface", text: "Text", link: "Links", operational: "Operational", degraded: "Degraded performance", partial: "Partially unavailable", major: "Major outage", maintenance: "Maintenance" };
    for (const [key, label] of Object.entries(labels)) await page.getByRole("textbox", { name: `${label} hex colour`, exact: true }).fill(theme.palette[key]);
    await open("Font and header image");
    await page.getByRole("combobox", { name: /^Page font/ }).selectOption("mono");
    await page.getByLabel(/^Upload font/).setInputFiles({ name: "synthetic-lamp-1.woff2", mimeType: "font/woff2", buffer: font });
    await page.getByRole("button", { name: "Upload font", exact: true }).click();
    await expect.poll(async () => (await currentSettings()).theme.font).toBe("uploaded");
    await page.getByLabel(/^Upload header image/).setInputFiles({ name: "synthetic-lamp-2.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "Upload header image", exact: true }).click();
    await expect.poll(async () => (await currentSettings()).theme.headerImage).toBe(true);
    await open("Header and footer links");
    await page.getByRole("button", { name: "Add header link", exact: true }).click();
    await page.getByRole("button", { name: "Add footer link", exact: true }).click();
    await page.getByLabel("Header link 1 label").fill(theme.headerLinks[0].label);
    await page.getByLabel("Header link 1 address").fill(theme.headerLinks[0].href);
    await page.getByLabel("Footer link 1 label").fill(theme.footerLinks[0].label);
    await page.getByLabel("Footer link 1 address").fill(theme.footerLinks[0].href);
    await open("Layout and history");
    await page.getByLabel("Collapse component groups by default").check();
    await page.getByLabel(/^History days/).fill("14");
    await page.getByLabel("Show uptime for Web application", { exact: true }).uncheck();
    await open("Custom HTML and CSS");
    await page.getByLabel(/^Header HTML/).fill(theme.headerHtml);
    await page.getByLabel(/^Footer HTML/).fill(theme.footerHtml);
    await page.getByLabel(/^Custom CSS/).fill(theme.customCss);
    await expect.poll(async () => (await currentSettings()).theme).toEqual({ ...theme, font: "uploaded", headerImage: true });
    await snapshot("Service updates from the Atlas team.");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({ path: `${directory}/settings-${width}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Settings fits ${width}`);
    }
    const publicPage = await context.newPage();
    const paths = new Set();
    const outsiders = new Set();
    publicPage.on("request", request => {
      const url = new URL(request.url());
      if (request.resourceType() === "document" || !["http:", "https:"].includes(url.protocol)) return;
      if (url.origin === pageUrl) paths.add(url.pathname);
      else outsiders.add(url.origin);
    });
    const response = await publicPage.goto(`${pageUrl}/`, { waitUntil: "networkidle" });
    assert.match(response.headers()["content-security-policy"], /style-src [^;]+;.*img-src [^;]+;/);
    assert.equal(outsiders.size, 0);
    assert.ok(paths.size <= 4, `Theme assets stay in the four-request budget: ${[...paths]}`);
    await publicPage.evaluate(() => document.fonts.ready);
    assert.equal(await publicPage.evaluate(() => [...document.fonts].some(face => face.family.includes("Owner Font") && face.status === "loaded")), true);
    const palette = await publicPage.locator("body").evaluate(element => {
      const style = getComputedStyle(element);
      return Object.fromEntries(["--paper", "--card", "--ink", "--theme-link", "--ok", "--degraded", "--cell-partial", "--down", "--maint"].map(key => [key, style.getPropertyValue(key).trim()]));
    });
    assert.deepEqual(palette, { "--paper": theme.palette.background, "--card": theme.palette.surface, "--ink": theme.palette.text, "--theme-link": theme.palette.link, "--ok": theme.palette.operational, "--degraded": theme.palette.degraded, "--cell-partial": theme.palette.partial, "--down": theme.palette.major, "--maint": theme.palette.maintenance });
    assert.equal(await publicPage.locator(".owner-note").evaluate(element => getComputedStyle(element).letterSpacing), "0.4px");
    assert.equal(await publicPage.locator("body").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(244, 244, 244)");
    assert.equal(await publicPage.locator(".theme-header-image").evaluate(element => element.complete && element.naturalWidth > 0), true);
    await expect(publicPage.getByRole("link", { name: "Customer support", exact: true })).toHaveAttribute("href", theme.headerLinks[0].href);
    await expect(publicPage.getByRole("link", { name: "Service history", exact: true })).toHaveAttribute("href", "/history");
    assert.equal(await publicPage.evaluate(() => window.themeUnsafe), undefined);
    for (const width of [1440, 390]) {
      await publicPage.setViewportSize({ width, height: 1000 });
      await publicPage.screenshot({ path: `${directory}/page-${width}.png`, fullPage: true });
      assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Public theme fits ${width}`);
      const group = publicPage.locator("details.component-group").first();
      assert.equal(await group.getAttribute("open"), null);
      await group.locator("summary").click();
      await expect(group.locator(".component").first()).toBeVisible();
      await group.locator("summary").click();
    }
    const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 1000 } });
    const literal = await noScript.newPage();
    await literal.goto(`${pageUrl}/`);
    await expect(literal.locator(".owner-note")).toHaveText("Service updates from the Atlas team.");
    await expect(literal.locator(".theme-footer")).toContainText("Always here to help.");
    await noScript.close();
    await context.close();
  } finally { await browser.close(); }
}
