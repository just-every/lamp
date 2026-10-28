import assert from "node:assert/strict";
import { operatorHydrated } from "./operator-hydrated.mjs";

/** Keep Date fixed just before a check is one minute old, while timers and
 * animation frames continue normally. The server still sees a fresh check. */
export async function overviewTimeFlow({ context, origin, publicOrigin }) {
  const tick = await fetch(`${publicOrigin.replace("localhost", "127.0.0.1")}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("* * * * *")}&time=${Date.now()}`);
  assert.equal(tick.status, 200, await tick.text());
  const liveResponse = await context.request.get(`${origin}/api/app/overview/live`);
  assert.equal(liveResponse.status(), 200);
  const { live } = await liveResponse.json();
  assert.ok(live.page?.ok && live.subscribe?.ok, "the native public-page checks passed");
  const checkedAt = live.page.checkedAt;
  const now = Date.parse(checkedAt) + 59_999;
  const page = await context.newPage();
  const errors = [];
  page.on("console", message => { if (/hydration|did not match|server rendered/i.test(message.text())) errors.push(message.text()); });
  page.on("pageerror", error => { if (/hydration|did not match|server rendered/i.test(error.message)) errors.push(error.message); });
  await page.clock.setFixedTime(new Date(now));
  const response = await page.goto(`${origin}/app`);
  assert.equal(response.status(), 200);
  const html = await response.text();
  const serverText = /page and subscribe form checked ([\s\S]*?)<\/span>/.exec(html)?.[1].replaceAll("<!-- -->", "").trim();
  await operatorHydrated(page);
  const clientText = "page and subscribe form checked 1 minute ago";
  await page.getByText(clientText, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Date.now()), now, "the browser clock stays just before the minute boundary");
  console.log(`Overview minute boundary: SSR=${serverText}; client=1 minute ago; hydration errors=${errors.length}`);
  assert.deepEqual(errors, [], "Overview hydration across the first minute");
  assert.equal(serverText, checkedAt, "SSR uses the stable timestamp until the first client effect");
}
