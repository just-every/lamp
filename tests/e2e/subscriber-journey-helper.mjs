import { assertAppliedStyles } from "../helpers/applied-styles.mjs";
import assert from "node:assert/strict";
import { accessibilityFailure, analyzeScriptFreePage, newScriptFreePage, observeAuditPage } from "./subscriber-audit-helper.mjs";
import { assertSubscriberIsolation } from "./subscriber-isolation-helper.mjs";

const widths = [1440, 390, 320];
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page, response, status, diagnostics) {
  diagnostics.action = diagnostics.phase;
  diagnostics.phase = "HTTP status";
  diagnostics.documentType = (await response?.allHeaders())?.["content-type"]?.startsWith("text/html") ? "html" : "other";
  if (response?.request().method() === "POST") {
    const request = response.request();
    const headers = await request.allHeaders();
    diagnostics.postOrigin = headers.origin === undefined ? "absent" : headers.origin === "null" ? "null" : headers.origin === new URL(request.url()).origin ? "same-origin" : "other";
    diagnostics.postSite = ["none", "same-origin", "same-site", "cross-site"].includes(headers["sec-fetch-site"]) ? headers["sec-fetch-site"] : "other";
  }
  assert.equal(response?.status(), status, "native form result HTTP status");
  diagnostics.phase = "subscriber isolation headers";
  assertSubscriberIsolation(new Headers(await response.allHeaders()), new URL(response.url()).origin);
  diagnostics.phase = "document and stylesheet";
  assert.equal(await page.locator("main.subscriber-page h1").count(), 1);
  await assertAppliedStyles(page);
  diagnostics.phase = "horizontal overflow";
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow");
  diagnostics.phase = "Axe";
  const results = await analyzeScriptFreePage(page, tags);
  diagnostics.axeRules = results.violations.map(item => item.id);
  assert.equal(results.violations.length, 0, `WCAG violations: ${results.violations.map(item => item.id).join(", ")}`);
  diagnostics.phase = "cookieless response";
  assert.equal((await response.allHeaders())["set-cookie"], undefined, "subscriber journey stays cookieless");
}

async function submit(page, name, diagnostics) {
  diagnostics.phase = "native POST navigation";
  const [response] = await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    page.getByRole("button", { name, exact: true }).click(),
  ]);
  return response;
}

async function subscribe(page, origin, email, diagnostics) {
  diagnostics.phase = "load subscribe form";
  await page.goto(origin, { waitUntil: "networkidle" });
  diagnostics.phase = "enter email";
  await page.locator('input[name="email"]').fill(email);
  return submit(page, "Subscribe", diagnostics);
}

export async function auditUnavailableSubscriptionForms(browser, origin, resetSubscriptionRateWindow) {
  for (const width of widths) {
    await resetSubscriptionRateWindow();
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
    const diagnostics = { journey: "missing mail", phase: "new page", width };
    try {
      const page = await newScriptFreePage(context);
      observeAuditPage(page, diagnostics);
      await audit(page, await subscribe(page, origin, `unavailable-${width}@example.test`, diagnostics), 503, diagnostics);
      diagnostics.journey = "invalid email";
      diagnostics.phase = "load subscribe form";
      await page.goto(origin, { waitUntil: "networkidle" });
      // A normal browser prevents this submission. Disable native validation to
      // exercise the server's malformed-input response through the same form.
      await page.locator('form[action="/subscribe"]').evaluate(form => { form.noValidate = true; });
      await page.locator('input[name="email"]').fill("not-an-email");
      await audit(page, await submit(page, "Subscribe", diagnostics), 400, diagnostics);
    } catch (cause) { throw accessibilityFailure(cause, "Script-free subscription", diagnostics); }
    finally { await context.close(); }
  }
}
