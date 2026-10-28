import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { expect } from "@playwright/test";

const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page, label) {
  // Native form results can show their heading before the shared stylesheet loads.
  await page.waitForLoadState("load");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no horizontal overflow`);
  const result = await new AxeBuilder({ page }).withTags(tags).analyze();
  assert.deepEqual(result.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => ({ id: row.id, nodes: row.nodes.map(node => node.target) })), [], `${label}: no serious or critical axe finding`);
}

async function assertVisibleFocus(target, label) {
  const focus = await target.evaluate(node => {
    const style = getComputedStyle(node);
    return { active: document.activeElement === node, visible: node.matches(":focus-visible"), outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 && !["transparent", "rgba(0, 0, 0, 0)"].includes(style.outlineColor), shadow: style.boxShadow !== "none" };
  });
  assert.ok(focus.active && focus.visible && (focus.outline || focus.shadow), `${label}: keyboard focus is visible: ${JSON.stringify(focus)}`);
}

async function tabTo(page, target, label) {
  const count = await page.locator('a[href],button,input:not([type="hidden"]),select,textarea,[tabindex="0"]').count();
  for (let index = 0; index <= count + 2; index++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(node => document.activeElement === node)) { await assertVisibleFocus(target, label); return; }
  }
  assert.fail(`${label}: ordinary Tab order did not reach the control`);
}

/** Public footer links remain usable at the caller's desktop or phone width. */
export async function footerAccessibilityResourcesFlow({ page, appUrl, pageUrl, width }) {
  const resources = page.locator('footer details.footer-resources');
  await resources.locator('summary').click();
  const calendar = resources.getByRole('link', { name: 'Maintenance calendar', exact: true });
  await expect(calendar).toHaveAttribute('href', '/maintenance.ics');
  const calendarResponse = await page.request.get(new URL(await calendar.getAttribute('href'), pageUrl).href);
  assert.equal(calendarResponse.status(), 200);
  assert.match(calendarResponse.headers()['content-type'], /^text\/calendar/);
  const vpat = resources.getByRole('link', { name: 'Accessibility (VPAT)', exact: true });
  await expect(vpat).toHaveAttribute('href', `${appUrl}/docs/accessibility/vpat`);
  if (process.env.LAMP_SCREENSHOTS) {
    await mkdir(process.env.LAMP_SCREENSHOTS, { recursive: true });
    await resources.scrollIntoViewIfNeeded();
    await page.locator('footer').screenshot({ path: `${process.env.LAMP_SCREENSHOTS}/${width}-public-footer.png` });
  }
  await vpat.click();
  await page.waitForURL(`${appUrl}/docs/accessibility/vpat`);
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  await audit(page, `${width}px VPAT reached from the public footer`);
  await page.goto(`${pageUrl}/`);
}

/** Real public HTML forms, driven only with Tab, text keys, Space and Enter.
 * The fixture reconstructs ONLY its own signed tokens at the mail/token edge,
 * from the same known synthetic key used by the isolated local Worker. */
export async function accessibilitySubscriptionFlow({ page, appUrl, pageUrl, incident, maintenance, tokenSecret, tokenRows, diagnostic = () => {} }) {
  const originalViewport = page.viewportSize();
  const hydrationErrors = [];
  const observeConsole = message => { if (/hydration|did not match|server rendered/i.test(message.text())) hydrationErrors.push(message.text()); };
  const observePageError = error => { if (/hydration|did not match|server rendered/i.test(error.message)) hydrationErrors.push(error.message); };
  const token = row => `v1.${row.scope}.${row.id}.${createHmac("sha256", tokenSecret).update(`lamp-subscriber-token.v1.${row.scope}.${row.id}`).digest("base64url")}`;
  page.on("console", observeConsole); page.on("pageerror", observePageError);
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [host, path, label, selector] of [
        [pageUrl, "/", "public status page", "main.root-page"],
        [pageUrl, "/history", "public history", "main.page"],
        [pageUrl, `/incidents/${incident.reference}`, "public incident permalink", "main.page"],
        [appUrl, "/docs/accessibility/vpat", "VPAT document", "main"],
      ]) {
        const response = await page.goto(`${host}${path}`);
        assert.equal(response.status(), 200, `${width}px ${label} is served`);
        await page.locator(selector).first().waitFor();
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await audit(page, `${width}px ${label}`);
        diagnostic(`PAGE-020 ${width}px ${label}: full-page axe and no horizontal overflow passed`);
      }
      const permanent = await page.goto(`${pageUrl}/maintenance/${maintenance.reference}`);
      assert.equal(permanent.status(), 200);
      await page.getByRole("heading", { name: maintenance.title, exact: true }).waitFor();
      await audit(page, `${width}px public maintenance permalink`);

      await page.goto(`${pageUrl}/`);
      await footerAccessibilityResourcesFlow({ page, appUrl, pageUrl, width });
      const form = page.locator('form[action="/subscribe"]').first();
      const email = form.getByRole("textbox", { name: "Email address", exact: true });
      await email.waitFor();
      await tabTo(page, email, `${width}px subscription email`);
      const address = `synthetic-lamp-020-${width}@example.test`;
      await page.keyboard.type(address);
      await page.keyboard.press("Tab");
      const subscribe = form.getByRole("button", { name: "Subscribe", exact: true });
      await assertVisibleFocus(subscribe, `${width}px email → subscribe focus order`);
      const submitted = page.waitForResponse(response => new URL(response.url()).pathname === "/subscribe" && response.request().method() === "POST");
      await page.keyboard.press("Enter");
      assert.equal((await submitted).status(), 202);
      await page.getByRole("heading", { name: "Check your inbox", exact: true }).waitFor();
      await audit(page, `${width}px subscription result`);
      const issued = await tokenRows(address);
      const confirm = issued.find(row => row.scope === "confirm"), manage = issued.find(row => row.scope === "manage");
      assert.ok(confirm && manage, "the real subscription issued confirmation and management links");
      const confirmed = await page.goto(`${pageUrl}/confirm-subscription/${token(confirm)}`);
      assert.equal(confirmed.status(), 200);
      await page.getByRole("heading", { name: "Subscription confirmed", exact: true }).waitFor();
      await audit(page, `${width}px subscription confirmation`);
      await page.goto(`${pageUrl}/manage/${token(manage)}`);
      await page.getByRole("heading", { name: "Manage subscription", exact: true }).waitFor();
      const choices = page.getByRole("checkbox");
      assert.ok(await choices.count() >= 2, "the real management form offers at least two component choices");
      const first = choices.first();
      await tabTo(page, first, `${width}px management component`);
      assert.equal(await first.isChecked(), true);
      await page.keyboard.press("Space");
      assert.equal(await first.isChecked(), false);
      await page.keyboard.press("Tab");
      await assertVisibleFocus(choices.nth(1), `${width}px component → component focus order`);
      const save = page.getByRole("button", { name: "Save selection", exact: true });
      await tabTo(page, save, `${width}px save selection`);
      await audit(page, `${width}px subscription management`);
      const saved = page.waitForResponse(response => new URL(response.url()).pathname.startsWith("/manage/") && response.request().method() === "POST");
      await page.keyboard.press("Enter");
      assert.equal((await saved).status(), 200);
      await page.getByRole("heading", { name: "Subscription updated", exact: true }).waitFor();
      await audit(page, `${width}px saved subscription`);
      await page.goto(`${pageUrl}/manage/${token(manage)}`);
      await expect(page.getByRole("checkbox").first()).not.toBeChecked();
      diagnostic(`PAGE-020 ${width}px: full-page status, history, incident, maintenance, VPAT, subscribe result, confirmation, management and saved selection axe passed; keyboard-only subscribe/manage with visible focus and ordered controls passed`);
    }
    assert.deepEqual(hydrationErrors, []);
  } finally {
    page.off("console", observeConsole); page.off("pageerror", observePageError);
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
