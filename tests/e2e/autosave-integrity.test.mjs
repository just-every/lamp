import {appOrigin} from './helpers/hosts.mjs';
import { withDraftVersion } from "./draft-version-helper.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { insertRealOperatorSession } from "./real-session-helper.mjs";
import { reservePort, waitForWorker } from "./worker-startup.mjs";
import { assertAutosaveDuringRefresh } from "./autosave-refresh-regression.mjs";
import { assertQueuedAutosaveDeadline } from "./autosave-queue-regression.mjs";
import { assertComposerVisitIsolation } from "./composer-visit-regression.mjs";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

let worker, browser, context, page, statePath, cachePath, origin;
let output = "";
before(async () => {
  statePath = await mkdtemp(join(tmpdir(), "lamp-autosave-integrity-d1-"));
  cachePath = await mkdtemp(join(tmpdir(), "lamp-autosave-integrity-vite-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", statePath], { stdio: "pipe" });
  const sessionId = await insertRealOperatorSession({ persistTo: statePath });
  // Reserve after Wrangler finishes: its emulator also allocates local ports.
  const port = await reservePort({ label: "Autosave integrity Worker" });
  origin = appOrigin(port);
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    detached: true, stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: cachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  worker.stdout.on("data", chunk => { output += chunk; });
  worker.stderr.on("data", chunk => { output += chunk; });
  await waitForWorker({ origin, child: worker, output: () => output, label: "Autosave integrity Worker" });
  browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Loaded verification runners need more than the 30-second default for the
  // reconcile read that follows a lost save; every assertion is unchanged.
  context.setDefaultTimeout(60_000);
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

async function api(path, method = "GET", body) {
  const init = await withDraftVersion(path, { method, headers:{Origin:origin}, ...(body ? { data: body } : {}) }, route => context.request.get(`${origin}${route}`).then(response => ({ status: response.status(), json: () => response.json() })));
  const response = await context.request.fetch(`${origin}${path}`, init);
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
const initial = { lifecycle: "Investigating", affectedAudience: "Initial audience", customerImpact: "Service delays", whatStillWorks: "Other services", details: "Private draft", nextUpdateAt: "2027-09-08T14:00:00.000Z" };
async function openIncident() {
  const { component } = await api("/api/app/components", "POST", { groupId: null, name: "Autosave integrity API", description: "", internal: false, displayOrder: 1, note: "" });
  const { incident } = await api("/api/app/incidents", "POST", { title: "Autosave integrity", components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
  await api(`/api/app/incidents/${incident.id}/draft`, "PUT", initial);
  await page.goto(`${origin}/app/incidents/${incident.id}`);
  // Development can mount the visit twice; act only on the settled visit.
  await page.waitForLoadState("networkidle");
  await page.locator(".autosave-status.is-saved").waitFor();
  return incident;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function waitForAutosave(promise, phase) {
  let timeout;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Autosave did not reach ${phase} within 10 seconds.`)), 10_000); }),
    ]);
  } finally { clearTimeout(timeout); }
}
async function assertPrivateUnsaved() {
  assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "Schedule update", exact: true, includeHidden: true }).isEnabled(), false);
  await page.locator(".autosave-status").waitFor();
  assert.equal(await page.locator(".autosave-status.is-saved").count(), 0);
}

test("Serialized autosave preserves the latest displayed bytes across delayed and lost responses", async t => {
  for (const mode of ["delayed response", "delayed request", "reverted edit after lost response"]) {
  t.diagnostic(`serialized autosave preserves latest displayed bytes with ${mode}`);
    await (async () => {
    const incident = await openIncident();
    const field = page.locator(".impact-field textarea").first();
    const entered = deferred(), release = deferred(), secondEntered = deferred(), releaseSecond = deferred();
    let requests = 0;
    const endpoint = `**/api/app/incidents/${incident.id}/draft`;
    await page.route(endpoint, async route => {
      requests++;
      if (requests === 1) {
        if (mode === "delayed request") {
          entered.resolve();
          await release.promise;
          await route.continue();
        } else {
          const response = await route.fetch(); // Real native Worker persisted the earlier bytes.
          entered.resolve();
          await release.promise;
          if (mode === "reverted edit after lost response") await route.abort();
          else await route.fulfill({ response });
        }
      } else {
        secondEntered.resolve();
        await releaseSecond.promise;
        await route.continue();
      }
    });
    const latest = mode === "reverted edit after lost response" ? initial.affectedAudience : "Newest operator audience";
    try {
      await field.fill("Earlier operator audience");
      await waitForAutosave(entered.promise, "the first intercepted write");
      await field.fill(latest);
      await page.waitForTimeout(1500); // A later write must not overtake the pending earlier write.
      assert.equal(requests, 1);
      await assertPrivateUnsaved();
      release.resolve();
      await waitForAutosave(secondEntered.promise, "the latest displayed draft write");
      await assertPrivateUnsaved();
      assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, "Earlier operator audience");
      releaseSecond.resolve();
      await page.locator(".autosave-status.is-saved").waitFor();
      assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, latest);
      assert.equal(await field.inputValue(), latest);
      await page.reload();
      await page.locator(".autosave-status.is-saved").waitFor();
      assert.equal(await field.inputValue(), latest);
      if (mode === "delayed request") {
        await page.getByText("Schedule or backdate", { exact: true }).click();
        await page.getByLabel("Scheduled publication date and time").fill("2027-09-08T13:30");
        const scheduleResponse = page.waitForResponse(response => response.url().endsWith(`/incidents/${incident.id}/draft/schedule`) && response.request().method() === "POST");
        await page.getByRole("button", { name: "Schedule update", exact: true }).click();
        assert.equal((await scheduleResponse).status(), 202);
        const scheduled = (await api(`/api/app/incidents/${incident.id}`)).incident.draft;
        assert.equal(scheduled.affectedAudience, latest);
        assert.ok(typeof scheduled.scheduledPublishAt === "string" && scheduled.scheduledPublishAt.length > 0 && Number.isFinite(Date.parse(scheduled.scheduledPublishAt)), "the acknowledged draft has a recorded scheduled instant");
        assert.equal(scheduled.scheduledPublishAt, (await (await scheduleResponse).json()).draft.scheduledPublishAt);
      } else {
        const publishResponse = page.waitForResponse(response => response.url().endsWith(`/incidents/${incident.id}/publish`) && response.request().method() === "POST");
        await page.getByRole("button", { name: "Publish update", exact: true }).click();
        assert.equal((await publishResponse).ok(), true);
        await page.locator(".autosave-status.is-empty").waitFor();
        assert.equal(await field.inputValue(), "");
        await assertPrivateUnsaved();
        await page.waitForTimeout(1500);
        const published = (await api(`/api/app/incidents/${incident.id}`)).incident;
        assert.equal(published.updates[0].affectedAudience, latest);
        assert.equal(published.draft, null, "publication leaves the next draft absent until the operator edits it");
      }
    } finally {
      release.resolve(); releaseSecond.resolve();
      await page.unrouteAll({ behavior: "wait" });
    }
  })(t);
}
});

test("Autosave failure, revert, template and manual retry retain the actual displayed draft", async t => {
  t.diagnostic("a failed current save stays unsaved; reverting repairs uncertain server state");
  await (async () => {
  const incident = await openIncident();
  const field = page.locator(".impact-field textarea").first();
  const endpoint = `**/api/app/incidents/${incident.id}/draft`;
  // Keep the route installed for the whole case: a one-shot route is removed
  // while the composer's follow-up read is in flight, and Playwright can then
  // leave that read paused forever.
  let lost = false;
  await page.route(endpoint, async route => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch(); // Lose the acknowledgement after native persistence.
    await route.abort();
  });
  try {
    await field.fill("Persisted without acknowledgement");
    await page.locator(".autosave-status.is-error").waitFor();
    await assertPrivateUnsaved();
    await page.waitForTimeout(1500);
    assert.equal(await page.locator(".autosave-status.is-error").count(), 1);
    await field.fill(initial.affectedAudience);
    await page.locator(".autosave-status.is-saved").waitFor();
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, initial.affectedAudience);
  } finally { await page.unrouteAll({ behavior: "wait" }); }
})(t);
  t.diagnostic("reverting before debounce restores saved status without a redundant write");
  await (async () => {
  const incident = await openIncident();
  const field = page.locator(".impact-field textarea").first();
  const requests = [];
  const record = request => { if (request.method() === "PUT" && request.url().endsWith(`/incidents/${incident.id}/draft`)) requests.push(request); };
  page.on("request", record);
  await field.fill("Transient edit");
  await assertPrivateUnsaved();
  await field.fill(initial.affectedAudience);
  await page.locator(".autosave-status.is-saved").waitFor();
  assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), true);
  await page.waitForTimeout(1500);
  page.off("request", record);
  assert.equal(requests.length, 0);
})(t);
  t.diagnostic("an applied native template becomes the displayed and saved draft");
  await (async () => {
  const incident = await openIncident();
  const field = page.locator(".impact-field textarea").first();
  await page.locator("summary", { hasText: "Update templates" }).click();
  await page.getByLabel("Template name", { exact: true }).fill("Autosave template integrity");
  await page.getByRole("button", { name: "Save template", exact: true }).click();
  await page.getByText("Template saved.", { exact: true }).waitFor();
  await field.fill("Draft to replace with the template");
  await page.locator(".autosave-status.is-saved").waitFor();
  await page.getByLabel("Saved update template", { exact: true }).selectOption({ label: "Autosave template integrity" });
  await page.getByRole("button", { name: "Apply template", exact: true }).click();
  await page.getByText("Template filled the private draft.", { exact: true }).waitFor();
  await page.locator(".autosave-status.is-saved").waitFor();
  assert.equal(await field.inputValue(), initial.affectedAudience);
  assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, initial.affectedAudience);
})(t);
  t.diagnostic("manual retry saves the retained draft after a transient transport failure");
  await (async () => {
  const incident = await openIncident();
  const field = page.locator(".impact-field textarea").first();
  let requests = 0;
  const endpoint = `**/api/app/incidents/${incident.id}/draft`;
  await page.route(endpoint, async route => {
    requests++;
    if (requests === 1) await route.abort();
    else await route.continue();
  });
  try {
    await field.fill("Retain these edits for manual retry");
    await page.locator(".autosave-status.is-error").waitFor();
    await assertPrivateUnsaved();
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, initial.affectedAudience);
    await page.waitForTimeout(1500);
    assert.equal(requests, 1, "failure must not start an automatic retry loop");
    assert.equal(await page.getByRole("button", { name: "Retry save", exact: true }).count(), 1, await page.locator(".composer-panel").innerText());
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    assert.equal(await field.inputValue(), "Retain these edits for manual retry");
    await page.locator(".autosave-status.is-saved").waitFor();
    assert.equal(requests, 2);
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, "Retain these edits for manual retry");
    assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Schedule update", exact: true, includeHidden: true }).isEnabled(), true);
  } finally { await page.unrouteAll({ behavior: "wait" }); }
})(t);
});







test("Private-note refresh and queued saves preserve the latest edit deadline", async t => {
  t.diagnostic("a private-note refresh preserves the original two-second autosave deadline");
  await (async t => {
  await assertAutosaveDuringRefresh({ page, api, openIncident, assertPrivateUnsaved, initial }, t);
})(t);
  t.diagnostic("queued autosave preserves the latest edit deadline");
  await (async t => {
  await assertQueuedAutosaveDeadline({ page, api, openIncident, assertPrivateUnsaved, initial }, t);
})(t);
});




test("a lost acknowledgement never authorizes overwriting another tab's scheduled draft", async () => {
  const incident = await openIncident();
  const entered = deferred(), release = deferred();
  const endpoint = `**/api/app/incidents/${incident.id}/draft`;
  const other = await context.newPage();
  let lost = false; // Installed for the whole case; see the lost-save case above.
  await page.route(endpoint, async route => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    entered.resolve();
    await release.promise;
    await route.abort();
  });
  try {
    await page.locator(".impact-field textarea").first().fill("Shared wording with a later scheduled transition");
    await waitForAutosave(entered.promise, "the write awaiting its lost acknowledgement");
    await other.goto(`${origin}/app/incidents/${incident.id}`);
    await other.locator(".autosave-status.is-saved").waitFor();
    await other.getByText("Schedule or backdate", { exact: true }).click();
    await other.getByLabel("Scheduled publication date and time").fill("2027-09-08T13:30");
    const scheduleResponse = other.waitForResponse(response => response.url().endsWith(`/incidents/${incident.id}/draft/schedule`) && response.request().method() === "POST");
    await other.getByRole("button", { name: "Schedule update", exact: true }).click();
    assert.equal((await scheduleResponse).status(), 202);
    const scheduled = (await api(`/api/app/incidents/${incident.id}`)).incident.draft;
    assert.ok(scheduled.scheduledPublishAt);
    assert.equal(scheduled.scheduledPublishAt, (await (await scheduleResponse).json()).draft.scheduledPublishAt);
    release.resolve();
    await page.locator(".autosave-status.is-error").waitFor();
    const rejected = page.waitForResponse(response => response.url().endsWith(`/incidents/${incident.id}/draft`) && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    assert.equal((await rejected).status(), 409);
    await page.locator(".autosave-status.is-error").waitFor();
    assert.deepEqual((await api(`/api/app/incidents/${incident.id}`)).incident.draft, scheduled);
    await assertPrivateUnsaved();
  } finally { release.resolve(); await page.unrouteAll({ behavior: "wait" }); await other.close(); }
});


test("leaving and returning to an incident revokes old save and publication completions", { timeout: 60_000 }, async () => {
  await assertComposerVisitIsolation({ page, api, openIncident, initial, waitForAutosave });
});
