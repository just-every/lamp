import { assertAppliedStyles } from "../helpers/applied-styles.mjs";
import assert from "node:assert/strict";
import { accessibilityFailure, analyzeScriptFreePage, newScriptFreePage, observeAuditPage } from "./subscriber-audit-helper.mjs";
import { assertSubscriberIsolation } from "./subscriber-isolation-helper.mjs";
import { devKeyHeaders } from "../helpers/dev-key.mjs";

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

async function mailedPath(origin, email, kind) {
  const response = await fetch(`${origin}/__dev/outbox?format=json`, { headers: devKeyHeaders });
  assert.equal(response.status, 200);
  const { envelopes } = await response.json();
  const envelope = envelopes.find(item => item.message.to === email && item.message.text.includes(`/${kind}/`));
  assert.ok(envelope, "native mail captured the expected subscriber link");
  const link = envelope.message.text.match(new RegExp(`https?://[^\\s]+/${kind}/[^\\s]+`));
  assert.ok(link, "captured mail contains the link");
  return new URL(link[0]).pathname;
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

export async function auditNativeSubscriberJourney(browser, origin, resetSubscriptionRateWindow) {
  for (const width of widths) {
    await resetSubscriptionRateWindow();
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
    const diagnostics = { journey: "subscribe", phase: "new page", width };
    try {
      const page = await newScriptFreePage(context);
      observeAuditPage(page, diagnostics);
      const email = `native-form-${width}@example.test`;
      await audit(page, await subscribe(page, origin, email, diagnostics), 202, diagnostics);
      const neutralResult = await page.locator("main").innerText();
      diagnostics.journey = "suppressed subscription";
      await audit(page, await subscribe(page, origin, email, diagnostics), 202, diagnostics);
      assert.equal(await page.locator("main").innerText(), neutralResult, "pending response does not disclose state");
      const confirm = await mailedPath(origin, email, "confirm-subscription");
      diagnostics.journey = "confirmation";
      diagnostics.phase = "confirmation navigation";
      await audit(page, await page.goto(origin + confirm, { waitUntil: "networkidle" }), 200, diagnostics);
      diagnostics.phase = "confirmation replay navigation";
      await audit(page, await page.goto(origin + confirm, { waitUntil: "networkidle" }), 404, diagnostics);
      diagnostics.journey = "management email";
      await audit(page, await subscribe(page, origin, email, diagnostics), 202, diagnostics);
      assert.equal(await page.locator("main").innerText(), neutralResult, "active response does not disclose state");
      const manage = await mailedPath(origin, email, "manage");
      diagnostics.journey = "selection";
      diagnostics.phase = "management navigation";
      await audit(page, await page.goto(origin + manage, { waitUntil: "networkidle" }), 200, diagnostics);
      diagnostics.phase = "change selection";
      const checks = page.locator('input[name="componentId"]');
      assert.ok(await checks.count() > 1, "multiple real visible components exercise narrowing");
      for (const check of await checks.all()) await check.uncheck();
      await checks.first().check();
      await audit(page, await submit(page, "Save selection", diagnostics), 200, diagnostics);
      diagnostics.phase = "management reload";
      await audit(page, await page.goto(origin + manage, { waitUntil: "networkidle" }), 200, diagnostics);
      diagnostics.phase = "persisted selection";
      assert.equal(await page.locator('input[name="componentId"]:checked').count(), 1, "selection persists after reload");
      diagnostics.phase = "read unsubscribe form action";
      // Read the real form through Playwright's DOM locator while application
      // script execution stays disabled, then resolve its action in Node.
      const unsubscribeAction = await page.locator("form").filter({ has: page.getByRole("button", { name: "Unsubscribe", exact: true }) }).getAttribute("action");
      assert.ok(unsubscribeAction, "management unsubscribe form has an action");
      const unsubscribe = new URL(unsubscribeAction, page.url()).pathname;
      diagnostics.journey = "scope isolation";
      diagnostics.phase = "wrong scope POST";
      const wrongScope = await fetch(origin + manage.replace("/manage/", "/unsubscribe/"), { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) });
      assert.equal(wrongScope.status, 404, "management token cannot authorize the unsubscribe endpoint");
      diagnostics.journey = "management unsubscribe";
      await audit(page, await submit(page, "Unsubscribe", diagnostics), 200, diagnostics);
      diagnostics.phase = "revoked management navigation";
      await audit(page, await page.goto(origin + manage, { waitUntil: "networkidle" }), 404, diagnostics);
      diagnostics.phase = "unsubscribe replay POST";
      const replay = await fetch(origin + unsubscribe, { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) });
      assert.equal(replay.status, 404, "deactivation revokes the unsubscribe token");
      diagnostics.journey = "expired unsubscribe form";
      diagnostics.phase = "unsubscribe navigation";
      await page.goto(origin + unsubscribe, { waitUntil: "networkidle" });
      await audit(page, await submit(page, "Unsubscribe", diagnostics), 404, diagnostics);
      diagnostics.journey = "one-click protocol";
      const protocolEmail = `native-one-click-${width}@example.test`;
      await audit(page, await subscribe(page, origin, protocolEmail, diagnostics), 202, diagnostics);
      diagnostics.phase = "one-click mail";
      const protocolPath = await mailedPath(origin, protocolEmail, "unsubscribe");
      diagnostics.phase = "one-click POST";
      const protocol = await fetch(origin + protocolPath, { method: "POST", headers: { Accept: "text/html" }, body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) });
      assert.equal(protocol.status, 200);
      assert.equal(await protocol.text(), "", "RFC 8058 success stays empty even with an HTML Accept header");
      assert.equal(protocol.headers.get("set-cookie"), null);
      assert.equal(protocol.headers.get("location"), null);
    } catch (cause) { throw accessibilityFailure(cause, "Script-free subscriber journey", diagnostics); }
    finally { await context.close(); }
  }
}
