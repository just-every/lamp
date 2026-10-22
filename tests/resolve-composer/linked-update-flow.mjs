import assert from "node:assert/strict";
import { join } from "node:path";

import { UPDATE_LINK_FIELDS } from "../e2e/helpers/update-component-flow.mjs";
import { LINKED_URL, assertPublicCsp } from "../e2e/helpers/update-link-evidence.mjs";
import { incidentComposer } from "../e2e/helpers/incident-composer.mjs";

const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const LITERALS = ['<a href="https://x.test">x</a>', "**markdown**", "javascript:alert(1)", "http://example.com/x", "data:text/html,x"];

/** UPDATE-011 and UPDATE-013 through the native composer and the public pages a reader opens.
 *  LAMP_BROWSER_PROOF_DIR, when set, receives a screenshot of each checked state. */
export async function linkedUpdateFlow({ browser, page, origin, pageBase, appFetch, createIncident, readIncident }) {
  const proof = async (target, name) => { if (process.env.LAMP_BROWSER_PROOF_DIR) await target.screenshot({ path: join(process.env.LAMP_BROWSER_PROOF_DIR, `${name}.png`), fullPage: true }); };
  const incident = await createIncident("Help centre article for API recovery", "Composer linked update component");
  await page.setViewportSize(VIEWPORTS[0]);
  await page.goto(`${origin}/app/incidents/${incident.id}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "First update" }).waitFor();
  const composer = incidentComposer(page);
  await composer.audience.fill(UPDATE_LINK_FIELDS.affectedAudience);
  await composer.impact.fill(UPDATE_LINK_FIELDS.customerImpact);
  await composer.moreOptions();
  await composer.stillWorks.fill(UPDATE_LINK_FIELDS.whatStillWorks);
  await composer.details.fill(UPDATE_LINK_FIELDS.details);
  await composer.nextUpdate.fill("2027-10-06T14:00");

  // Each internal URL produces its own finding, naming its rule.
  const internalHost = page.getByRole("button", { name: /^Dismiss wording check: Internal hostname:/ });
  const ipAddress = page.getByRole("button", { name: /^Dismiss wording check: IP address:/ });
  for (const [button, rule, host] of [[internalHost, "Internal hostname:", "db-prod-3.internal"], [ipAddress, "IP address:", "10.0.0.5"]]) {
    await button.waitFor();
    assert.equal(await button.count(), 1, `${host} is reported once`);
    const finding = page.locator(".wording-findings p").filter({ has: button });
    assert.ok((await finding.innerText()).startsWith(rule), `the ${host} finding names its rule`);
    assert.equal(await finding.locator("q").innerText(), host);
  }
  await page.locator(".autosave-status").getByText("Draft saved", { exact: true }).waitFor();
  await proof(page, "composer-findings-1440");
  await page.setViewportSize(VIEWPORTS[1]);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "composer findings fit at 390 pixels");
  await proof(page, "composer-findings-390");
  await internalHost.click();
  await ipAddress.click();
  assert.equal(await internalHost.count() + await ipAddress.count(), 0, "dismissed findings leave the composer");
  const publishResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/app/incidents/${incident.id}/publish`);
  await page.getByRole("button", { name: "Publish update", exact: true }).click();
  assert.equal((await publishResponse).status(), 200, "advisory findings never block publication");
  await page.getByText("Update published.", { exact: true }).waitFor();
  assert.equal((await readIncident(incident.id)).updates[0].customerImpact, UPDATE_LINK_FIELDS.customerImpact);
  await page.setViewportSize(VIEWPORTS[0]);

  const reader = async (path, label, expected) => {
    for (const javaScriptEnabled of [true, false]) for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ javaScriptEnabled, viewport });
      try {
        const view = await context.newPage();
        let response;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          response = await view.goto(`${pageBase}${path}`, { waitUntil: "load" });
          if (response.status() === 200 && (await view.content()).includes(expected)) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const state = `${label} ${viewport.width}px script ${javaScriptEnabled ? "on" : "off"}`;
        assert.equal(response.status(), 200, state);
        assertPublicCsp(new Headers(response.headers()), new URL(pageBase).origin, state);
        const facts = await view.evaluate(url => ({
          links: [...document.querySelectorAll(`a[href="${url}"]`)].map(link => ({ rel: link.rel, text: link.textContent, after: link.nextSibling?.textContent?.[0] ?? "" })),
          unsafe: [...document.querySelectorAll("a")].filter(link => /^(?:javascript:|data:|http:\/\/example\.com|https:\/\/x\.test)/.test(link.getAttribute("href") ?? "")).length,
          internal: ["https://db-prod-3.internal/x", "https://10.0.0.5/x"].map(href => document.querySelector(`a[href="${href}"]`)?.textContent ?? null),
          text: document.body.innerText,
          fits: document.documentElement.scrollWidth <= window.innerWidth,
        }), LINKED_URL);
        assert.ok(facts.links.length >= 3, `${state}: the named URL is linked in each place it appears`);
        for (const link of facts.links) assert.deepEqual([link.rel, link.text], ["nofollow noopener ugc", LINKED_URL], `${state}: the link shows its own URL`);
        assert.deepEqual([...new Set(facts.links.map(link => link.after))].sort(), [")", ",", "."], `${state}: trailing punctuation stays outside every link`);
        assert.deepEqual(facts.internal, ["https://db-prod-3.internal/x", "https://10.0.0.5/x"], `${state}: internal HTTPS URLs are links that show their URL`);
        assert.equal(facts.unsafe, 0, `${state}: no other scheme or markup becomes a link`);
        for (const literal of LITERALS) assert.ok(facts.text.includes(literal), `${state}: ${literal} is shown as text`);
        assert.ok(facts.fits, `${state}: the page fits its width`);
        await proof(view, `${label}-${viewport.width}-script-${javaScriptEnabled ? "on" : "off"}`);
      } finally { await context.close(); }
    }
  };
  await reader("/", "page", LINKED_URL);
  await reader(`/incidents/${incident.reference}`, "permalink", LINKED_URL);

  const saved = await appFetch(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ ...UPDATE_LINK_FIELDS, lifecycle: "Resolved", nextUpdateAt: null }) });
  assert.equal(saved.status, 200, await saved.text());
  const resolved = await appFetch(`/api/app/incidents/${incident.id}/publish`, { method: "POST", body: JSON.stringify({ channels: [] }) });
  assert.equal(resolved.status, 200, await resolved.text());
  await reader("/history", "history", incident.title);
}
