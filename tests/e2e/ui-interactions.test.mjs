import {appOrigin} from './helpers/hosts.mjs';
import { assertVisibleTime } from "../helpers/public-meaning.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";
import { operatorHydrated } from "./helpers/operator-hydrated.mjs";

let worker, browser, context, page, statePath, cachePath, origin;
let output = "";
before(async () => {
  const port = await reservePort({ label: "UI interaction Worker" });
  origin = appOrigin(port);
  statePath = await mkdtemp(join(tmpdir(), "lamp-ui-interactions-d1-"));
  cachePath = await mkdtemp(join(tmpdir(), "lamp-ui-interactions-vite-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", statePath], { stdio: "pipe" });
  const sessionId = await insertRealOperatorSession({ persistTo: statePath });
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    detached: true, stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: cachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  worker.stdout.on("data", chunk => { output += chunk; });
  worker.stderr.on("data", chunk => { output += chunk; });
  await waitForWorker({ origin, timeoutMs: 120_000, isListening: () => output.includes(`${origin}/`), child: worker, output: () => output, label: "UI interaction Worker" });
  browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  context = await browser.newContext({ timezoneId: "Australia/Brisbane", viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: sessionCookieName(origin), value: sessionId, url: origin }]);
  page = await context.newPage();
});
after(async () => {
  await browser?.close();
  if (worker && worker.exitCode === null) {
    const closed = new Promise(resolve => worker.once("close", resolve));
    try { process.kill(-worker.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await closed;
  }
  await Promise.all([statePath, cachePath].filter(Boolean).map(path => rm(path, { recursive: true, force: true })));
});

test("Component and group dialogs retain keyboard focus and phone subscribers and alert receipts fit while delivery tables scroll with the keyboard", async t => {
  for (const [triggerName, fieldName] of [["Add component", "Component name"], ["Add group", "Group name"]]) {
  t.diagnostic(`${triggerName} contains keyboard focus and restores its trigger`);
    await (async () => {
    await page.goto(`${origin}/app/components`); await operatorHydrated(page);
    await page.getByRole("heading", { name: "Add component", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const trigger = page.getByRole("button", { name: triggerName, exact: true }).first();
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel(fieldName, { exact: true }).evaluate(node => node === document.activeElement), true);
    const close = dialog.getByRole("button", { name: "Close component panel", exact: true });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    const submit = dialog.getByRole("button", { name: triggerName === "Add component" ? "Create component" : "Create group", exact: true });
    assert.equal(await submit.evaluate(node => node === document.activeElement), true, "reverse Tab wraps to the final control");
    await page.keyboard.press("Tab");
    assert.equal(await close.evaluate(node => node === document.activeElement), true, "Tab wraps to the first control");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true, "Escape restores the opening control");
  })(t);
}
  const subscriberDestination = "https://notify.example.test/phone-subscriber";
  await operatorApi("/api/app/subscribers/webhook", "POST", { destination: subscriberDestination, contactEmail: "phone-subscriber@example.test", componentIds: [] });
  await page.goto(`${origin}/app/subscribers`); await operatorHydrated(page);
  const subscriberRow = page.getByRole("row").filter({ hasText: subscriberDestination });
  await subscriberRow.getByRole("button", { name: "Remove", exact: true }).waitFor();
  const subscriberGeometry = await subscriberRow.getByRole("cell").evaluateAll(cells => cells.map(cell => { const box = cell.getBoundingClientRect(); return { left: box.left, right: box.right, scroll: cell.scrollWidth, width: cell.clientWidth }; }));
  assert.equal(subscriberGeometry.length, 6);
  assert.ok(subscriberGeometry.every(cell => cell.left >= 0 && cell.right <= 390 && cell.scroll <= cell.width), "every subscriber field and the removal action fit without horizontal scrolling");
  const subscriberState = subscriberRow.locator(".state-pill");
  assert.ok(await subscriberState.evaluate(node => node.getBoundingClientRect().right <= innerWidth && node.scrollWidth <= node.clientWidth), "the complete subscriber state fits");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const [route, label] of [["deliveries", "Delivery records"]]) {
  t.diagnostic(`${label} can be scrolled with the keyboard on narrow screens`);
    await (async () => {
    await page.goto(`${origin}/app/${route}`);
    const region = page.getByRole("region", { name: label, exact: true });
    await region.focus();
    assert.equal(await region.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(label => [...document.querySelectorAll('[role="region"]')].some(node => node.getAttribute("aria-label") === label && node.scrollLeft > 0), label);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  })(t);
  }
  const { source } = await operatorApi("/api/app/intake/sources", "POST", { name: "Phone receipt monitor", credentialKind: "bearer-token", bearerToken: "test-only-phone-receipt-token", deduplicationPath: "$.id", titlePath: "$.title", statePath: "$.state", recoveredValue: "recovered" });
  const response = await context.request.post(`${origin.replace("127.0.0.1", "localhost")}/api/intake/${source.id}`, { headers: { Authorization: "Bearer test-only-phone-receipt-token" }, data: { id: "phone-receipt", title: "Checkout failures", state: "firing" } });
  assert.equal(response.status(), 202);
  await page.goto(`${origin}/app/alerts`); await operatorHydrated(page);
  const receipt = page.locator(".receipt-card tr").filter({ hasText: "Phone receipt monitor" });
  await receipt.getByRole("link", { name: "Open draft", exact: true }).waitFor();
  const geometry = await receipt.locator("td").evaluateAll(cells => cells.map(cell => { const box = cell.getBoundingClientRect(); return { left: box.left, right: box.right, scroll: cell.scrollWidth, width: cell.clientWidth }; }));
  assert.equal(geometry.length, 5);
  assert.ok(geometry.every(cell => cell.left >= 0 && cell.right <= 390 && cell.scroll <= cell.width), "every receipt field and the draft action fit without horizontal scrolling");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

async function operatorApi(path, method = "GET", body) {
  const response = await context.request.fetch(`${origin}${path}`, { method, headers:{Origin:origin}, ...(body ? { data: body } : {}) });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.json();
}

test("Subscriber erasure requires confirmation and offers no repeated removal", async () => {
  const destination = "https://notify.example.test/lamp";
  const { subscriber } = await operatorApi("/api/app/subscribers/webhook", "POST", { destination, contactEmail: "ops@example.test", componentIds: [] });
  await page.goto(`${origin}/app/subscribers`);
  const row = page.getByRole("row").filter({ hasText: destination });
  await row.getByRole("button", { name: "Remove", exact: true }).waitFor();
  page.once("dialog", dialog => dialog.dismiss());
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  assert.equal((await operatorApi("/api/app/subscribers")).subscribers.some(item => item.id === subscriber.id && item.destination === destination), true, "cancel leaves the destination intact");
  page.once("dialog", dialog => dialog.accept());
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  const erased = page.getByRole("row").filter({ hasText: `deleted:${subscriber.id}` });
  await erased.waitFor();
  assert.equal(await erased.getByRole("button", { name: "Remove", exact: true }).count(), 0);
  const saved = (await operatorApi("/api/app/subscribers")).subscribers.find(item => item.id === subscriber.id);
  assert.equal(saved.contactEmail, null);
  assert.equal(saved.state, "deactivated");
});

const audienceField = target => target.locator("label.impact-field", { hasText: "Who is affected" }).locator("textarea");
const impactField = target => target.locator("label.impact-field", { hasText: "What is the impact" }).locator("textarea");

test("Fresh publication drafts and narrow operator navigation preserve deliberate sign-out", async t => {
  t.diagnostic("each publication opens a fresh unsaved draft, and stale tabs cannot replace its next update");
  await (async () => {
  const { component } = await operatorApi("/api/app/components", "POST", { groupId: null, name: "Operator journey API", description: "", internal: false, displayOrder: 5, note: "" });
  const { incident } = await operatorApi("/api/app/incidents", "POST", { title: "Operator journey", components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
  await page.goto(`${origin}/app/incidents/${incident.id}`);
  await operatorHydrated(page);
  await audienceField(page).fill("API customers"); await impactField(page).fill("Requests are failing");
  await page.getByLabel("Next update date and time").fill("2027-10-10T15:00");
  await page.locator(".autosave-status.is-saved").waitFor();
  assert.equal((await operatorApi(`/api/app/incidents/${incident.id}`)).incident.draft.nextUpdateAt, "2027-10-10T22:00:00.000Z", "composer uses the page Los Angeles zone despite a Brisbane browser");
  await page.locator(".time-warning[role=status]").waitFor();
  const previewTime = page.locator(".preview-card").first().locator("dt", { hasText: "Next update by" }).locator("xpath=following-sibling::dd[1]");
  await previewTime.waitFor();
  assertVisibleTime(await previewTime.textContent(), "2027-10-10T22:00:00.000Z", "America/Los_Angeles");
  await page.getByText("Update templates", { exact: true }).first().click();
  await page.getByLabel("Template name", { exact: true }).fill("Operator journey template");
  const templateResponse = page.waitForResponse(response => response.url().endsWith("/api/app/incident-templates") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save template", exact: true }).click();
  assert.equal((await templateResponse).status(), 201);
  const { templates } = await operatorApi("/api/app/incident-templates");
  const template = templates.find(item => item.name === "Operator journey template");
  assert.ok(template);
  const beforeOldClient = (await operatorApi(`/api/app/incidents/${incident.id}`)).incident;
  for (const [suffix, method, body] of [
    ["draft", "PUT", { lifecycle: "Investigating", affectedAudience: "Old client", customerImpact: "Old impact", whatStillWorks: "", details: "", nextUpdateAt: "2027-10-10T22:00:00.000Z" }],
    ["publish", "POST", { channels: [] }],
    ["draft/schedule", "POST", { channels: [], publishAt: "2027-10-10T21:00:00.000Z" }],
    [`templates/${template.id}/apply`, "POST", {}],
  ]) {
    const rejected = await context.request.fetch(`${origin}/api/app/incidents/${incident.id}/${suffix}`, { method, headers:{Origin:origin}, data: body });
    assert.equal(rejected.status(), 428, "Old clients without a version cannot change a draft");
  }
  assert.deepEqual((await operatorApi(`/api/app/incidents/${incident.id}`)).incident, beforeOldClient);

  await page.getByLabel("Next update date and time").fill("2026-11-01T01:30");
  await page.locator(".composer-panel").getByRole("alert").waitFor();
  await page.getByText("Schedule or backdate", { exact: true }).click();
  await page.getByLabel("Scheduled publication date and time").fill("2027-10-10T14:00");
  assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), false, "editing a valid schedule cannot clear an invalid commitment");
  await page.getByRole("button", { name: "Use current time", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), false);
  await page.getByLabel("Next update date and time").fill("2027-10-10T15:00");
  await page.locator(".autosave-status.is-saved").waitFor();
  const stale = await context.newPage();
  try {
    await stale.goto(page.url()); await stale.locator(".autosave-status.is-saved").waitFor();
    await operatorHydrated(stale);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const preview = page.getByRole("button", { name: "Preview", exact: true });
      const publish = page.getByRole("button", { name: "Publish update", exact: true });
      assert.equal(await preview.evaluate(node => Boolean(node.compareDocumentPosition([...document.querySelectorAll("button")].find(item => item.textContent === "Publish update")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
      const a = await preview.boundingBox(), b = await publish.boundingBox();
      assert.ok(a.y < b.y || (a.y === b.y && a.x < b.x));
      await preview.click(); await page.locator(".preview-panel").waitFor();
      const email = page.locator(".email-preview"); if (!await email.evaluate(node => node.open)) await email.locator("summary").click();
      for (const card of await page.locator(".preview-card").all()) {
        assert.equal(await card.evaluate(node => node.scrollWidth <= node.clientWidth), true);
        assert.equal(await card.evaluate(node => Boolean(node.compareDocumentPosition([...document.querySelectorAll("button")].find(item => item.textContent === "Publish update")) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "Preview content precedes Publish in reading order");
        if (width === 390) { const c = await card.boundingBox(), publishBox = await publish.boundingBox(); assert.ok(c.y + c.height <= publishBox.y, "The complete preview comes before Publish on mobile"); }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.LAMP_OPERATOR_SCREENSHOTS) {
        await mkdir(process.env.LAMP_OPERATOR_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: join(process.env.LAMP_OPERATOR_SCREENSHOTS, `operator-composer-${width}.png`), fullPage: true });
      }
      assert.ok(await page.getByLabel("Next update date and time").evaluate(node => Boolean(node.compareDocumentPosition([...document.querySelectorAll("button")].find(item => item.textContent === "Delete incident")) & Node.DOCUMENT_POSITION_FOLLOWING)));
    }
    const initialPlaceholder = await audienceField(page).getAttribute("placeholder");
    const publicationResponse = page.waitForResponse(response => response.url().endsWith(`/incidents/${incident.id}/publish`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Publish update", exact: true }).click();
    assert.equal((await publicationResponse).ok(), true);
    await page.locator(".composer-heading .publication-message.is-published").waitFor();
    assert.equal(await audienceField(page).inputValue(), ""); assert.equal(await impactField(page).inputValue(), "");
    assert.equal(await page.getByLabel("Status").inputValue(), "Identified");
    assert.equal(await audienceField(page).getAttribute("placeholder"), initialPlaceholder, "The audience prompt stays useful as the lifecycle advances");
    assert.match(await page.locator(".timeline").innerText(), /Requests are failing/);
    assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), false);
    await page.locator(".autosave-status").waitFor();
    assert.equal(await page.locator(".autosave-status.is-saved").count(), 0);
    assert.equal((await operatorApi(`/api/app/incidents/${incident.id}`)).incident.draft, null);
    await audienceField(page).fill("Next update audience");
    await page.locator(".autosave-status.is-saved").waitFor();
    assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), false, "An acknowledged but incomplete draft stays private");
    await page.reload(); await page.locator(".autosave-status.is-saved").waitFor();
    await operatorHydrated(page);
    assert.equal(await audienceField(page).inputValue(), "Next update audience");
    await stale.getByText("Update templates", { exact: true }).first().click();
    await stale.getByLabel("Saved update template").selectOption({ label: "Operator journey template" });
    const staleTemplate = stale.waitForResponse(response => response.url().includes(`/incidents/${incident.id}/templates/`) && response.url().endsWith("/apply"));
    await stale.getByRole("button", { name: "Apply template", exact: true }).click();
    assert.equal((await staleTemplate).status(), 409);
    assert.equal((await operatorApi(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, "Next update audience");
    const stalePublish = stale.waitForResponse(response => response.url().endsWith(`/incidents/${incident.id}/publish`) && response.request().method() === "POST");
    await stale.getByRole("button", { name: "Publish update", exact: true }).click();
    assert.equal((await stalePublish).status(), 409);
    await stale.getByText("Schedule or backdate", { exact: true }).click();
    await stale.getByLabel("Scheduled publication date and time").fill("2027-10-10T14:00");
    const staleSchedule = stale.waitForResponse(response => response.url().endsWith(`/incidents/${incident.id}/draft/schedule`));
    await stale.getByRole("button", { name: "Schedule update", exact: true }).click();
    assert.equal((await staleSchedule).status(), 409);
    await audienceField(stale).fill("Stale published wording"); await stale.locator(".autosave-status.is-error").waitFor();
    assert.equal((await operatorApi(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, "Next update audience");
    assert.equal(await stale.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), false);
    await stale.reload(); await stale.locator(".autosave-status.is-saved").waitFor();
    await operatorHydrated(stale);
    await audienceField(page).fill("Acknowledged newer bytes"); await page.locator(".autosave-status.is-saved").waitFor();
    await audienceField(stale).fill("Stale next draft"); await stale.locator(".autosave-status.is-error").waitFor();
    assert.equal((await operatorApi(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, "Acknowledged newer bytes");
  } finally { await stale.close(); }
})(t);
  t.diagnostic("every operator section and sign out is reachable at narrow widths");
  await (async () => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(`${origin}/app`);
    const nav = page.getByRole("navigation", { name: "Workspace sections" });
    if (width <= 900) await page.getByRole("button", { name: "Menu", exact: true }).click();
    const paths = await nav.locator("a").evaluateAll(nodes => nodes.map(node => node.pathname));
    for (const path of paths) {
      if (width <= 900 && !await nav.isVisible()) await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.locator(`.operator-navigation a[href="${path}"]`).click();
      await page.waitForURL(`${origin}${path}`); await page.waitForFunction(() => !document.querySelector('.operator-main .app-state[role="status"]'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path} at ${width}`);
    }
    await page.goto(`${origin}/app/incidents`);
    await page.getByRole("button", { name: "Create incident", exact: true }).click();
    if (width <= 900) await page.getByRole("button", { name: "Menu", exact: true }).click();
    const signout = page.getByRole("button", { name: "Sign out", exact: true });
    await signout.scrollIntoViewIfNeeded(); const box = await signout.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width);
    if (width !== 1440) {
      await signout.click(); await page.waitForURL(`${origin}/signin`);
      const sessionId = await insertRealOperatorSession({ persistTo: statePath });
      await context.addCookies([{ name: sessionCookieName(origin), value: sessionId, url: origin }]);
    }
    await page.goto(`${origin}/app/components`);
    for (const name of ["Set status", "Status history", "Edit component", "Add component", "Add group"]) {
      await page.getByRole("button", { name, exact: true }).first().click();
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      if (name === "Set status") {
        const select = dialog.getByLabel("Service status");
        const values = await select.locator("option").evaluateAll(options => options.map(option => option.value));
        for (const value of ["", "Operational", "Degraded performance", "Partially unavailable", "Major outage", "Under maintenance"]) assert.ok(values.includes(value));
        await select.selectOption("Degraded performance");
        assert.equal(await select.inputValue(), "Degraded performance");
      }
      if (name === "Status history") await dialog.getByRole("heading", { name: "Correct a past period" }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press("Escape");
    }
  }
})(t);
});



test("Concurrent component edits preserve newer ordering, visibility and names", async t => {
  t.diagnostic("ordering from an older tab preserves component visibility and names edited in another tab");
  await (async () => {
  const existing = await operatorApi("/api/app/components");
  const order = Math.max(0, ...existing.groups.map(group => group.displayOrder + 1));
  const { group } = await operatorApi("/api/app/component-groups", "POST", { name: "Move group", displayOrder: order });
  await operatorApi("/api/app/component-groups", "POST", { name: "Adjacent group", displayOrder: order + 1 });
  const { component: first } = await operatorApi("/api/app/components", "POST", { groupId: group.id, name: "Move first", description: "", internal: false, displayOrder: 0, note: "" });
  const { component: second } = await operatorApi("/api/app/components", "POST", { groupId: group.id, name: "Move second", description: "", internal: false, displayOrder: 0, note: "" });
  await page.goto(`${origin}/app/components`);
  await page.getByRole("button", { name: "Move Move first down", exact: true }).waitFor();
  const editor = await context.newPage();
  try {
    await editor.goto(page.url());
    await editor.locator(".component-row").filter({ hasText: "Move second" }).getByRole("button", { name: "Edit component", exact: true }).click();
    await editor.getByLabel("Component name", { exact: true }).fill("Renamed private service");
    await editor.getByLabel("Internal only", { exact: false }).check();
    await editor.getByRole("button", { name: "Save component", exact: true }).click();
    await editor.getByRole("dialog").waitFor({ state: "detached" });
    const writes = [];
    const record = request => { if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/app/component")) writes.push(request); };
    page.on("request", record);
    await page.getByRole("button", { name: "Move Move first down", exact: true }).click();
    await page.locator(".component-row-summary").getByText("Renamed private service", { exact: true }).waitFor();
    page.off("request", record);
    assert.equal(writes.length, 1, "The entire move is one ordering mutation");
    assert.ok(writes[0].url().endsWith(`/components/${first.id}/move`));
    assert.equal(writes[0].postDataJSON().internal, undefined);
    const moved = (await operatorApi("/api/app/components")).components.filter(item => item.groupId === group.id);
    assert.deepEqual(moved.map(item => item.id), [second.id, first.id]);
    assert.equal(moved[0].internal, true); assert.equal(moved[0].name, "Renamed private service");
    const stale = await context.request.post(`${origin}/api/app/components/${first.id}/move`, { headers:{Origin:origin}, data: { direction: "down", groupId: group.id, expectedIds: [first.id, second.id] } });
    assert.equal(stale.status(), 409);
    assert.deepEqual((await operatorApi("/api/app/components")).components.filter(item => item.groupId === group.id), moved, "Rejected stale moves have no partial effects");
    await editor.locator(".component-group-card").filter({ has: editor.getByRole("heading", { name: "Move group", exact: true }) }).getByRole("button", { name: "Edit group", exact: true }).click();
    await editor.getByLabel("Group name", { exact: true }).fill("Renamed group");
    await editor.getByRole("button", { name: "Save group", exact: true }).click();
    await editor.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Move Move group down", exact: true }).click();
    await page.getByRole("heading", { name: "Renamed group", exact: true }).waitFor();
    const groups = (await operatorApi("/api/app/components")).groups;
    assert.equal(groups.at(-1).id, group.id); assert.equal(groups.at(-1).name, "Renamed group");
  } finally { await editor.close(); }
})(t);
  t.diagnostic("older component and group name drawers preserve a newer explicit move after reload");
  await (async () => {
  const existing = await operatorApi("/api/app/components");
  const order = Math.max(0, ...existing.groups.map(group => group.displayOrder + 1));
  const { group } = await operatorApi("/api/app/component-groups", "POST", { name: "Open drawer group", displayOrder: order });
  const { group: adjacent } = await operatorApi("/api/app/component-groups", "POST", { name: "Open drawer adjacent", displayOrder: order + 1 });
  const { component: first } = await operatorApi("/api/app/components", "POST", { groupId: group.id, name: "Open drawer service", description: "Keep this description", internal: true, displayOrder: 4, note: "Keep this note" });
  const { component: second } = await operatorApi("/api/app/components", "POST", { groupId: group.id, name: "Open drawer sibling", description: "", internal: false, displayOrder: 9, note: "" });
  assert.equal(first.displayOrder, 4); assert.equal(second.displayOrder, 9);
  await operatorApi(`/api/app/components/${first.id}/standing-claim`, "PUT", { state: "Degraded performance" });
  const history = await operatorApi(`/api/app/components/${first.id}/history`);
  const editor = await context.newPage();
  try {
    for (const kind of ["components", "groups"]) {
      await page.goto(`${origin}/app/components`);
      await editor.goto(`${origin}/app/components`);
      const isComponent = kind === "components";
      const id = isComponent ? first.id : group.id;
      const name = isComponent ? first.name : group.name;
      const renamed = `${name} renamed`;
      const path = `/api/app/${isComponent ? "components" : "component-groups"}/${id}`;
      const card = isComponent
        ? editor.locator(".component-row").filter({ hasText: name })
        : editor.locator(".component-group-card").filter({ has: editor.getByRole("heading", { name, exact: true }) });
      await card.getByRole("button", { name: isComponent ? "Edit component" : "Edit group", exact: true }).click();
      await editor.getByRole("dialog").waitFor();
      const movedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${path}/move` && response.request().method() === "POST");
      await page.getByRole("button", { name: `Move ${name} down`, exact: true }).click();
      assert.equal((await movedResponse).status(), 200);
      const moved = await operatorApi("/api/app/components");
      assert.deepEqual(isComponent ? moved.components.filter(item => item.groupId === group.id).map(item => item.id) : moved.groups.slice(-2).map(item => item.id), isComponent ? [second.id, first.id] : [adjacent.id, group.id]);
      await editor.getByLabel(isComponent ? "Component name" : "Group name", { exact: true }).fill(renamed);
      const savedResponse = editor.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "PUT");
      await editor.getByRole("button", { name: isComponent ? "Save component" : "Save group", exact: true }).click();
      const saved = await savedResponse;
      assert.equal(saved.ok(), true);
      assert.equal(Object.hasOwn(saved.request().postDataJSON(), "displayOrder"), false, "A visible name edit has no hidden ordering mutation");
      await editor.getByRole("dialog").waitFor({ state: "detached" });
      await editor.reload();
      if (isComponent) await editor.locator(".component-row-summary").getByText(renamed, { exact: true }).waitFor();
      else await editor.getByRole("heading", { name: renamed, exact: true }).waitFor();
      const reloaded = await operatorApi("/api/app/components");
      for (const collection of ["components", "groups"]) {
        const withoutTimestamps = rows => rows.map(({ updatedAt, ...row }) => row);
        assert.deepEqual(withoutTimestamps(reloaded[collection]), withoutTimestamps(moved[collection].map(item => {
          if (collection === kind && item.id === id) return { ...item, name: renamed };
          if (!isComponent && collection === "components" && item.groupId === id) return { ...item, groupName: renamed };
          return item;
        })), "Saving an old drawer preserves every moved position and all other data");
      }
      assert.deepEqual(await operatorApi(`/api/app/components/${first.id}/history`), history, "Editing and moving never rewrite append-only state history");
    }
  } finally { await editor.close(); }
})(t);
});
