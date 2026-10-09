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

let worker, browser, context, page, statePath, cachePath, origin;
let output = "";
before(async () => {
  statePath = await mkdtemp(join(tmpdir(), "lamp-autosave-integrity-d1-"));
  cachePath = await mkdtemp(join(tmpdir(), "lamp-autosave-integrity-vite-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", "deploy/wrangler.template.toml", "--persist-to", statePath], { stdio: "pipe" });
  const sessionId = await insertRealOperatorSession({ persistTo: statePath });
  // Reserve after Wrangler finishes: its emulator also allocates local ports.
  const port = await reservePort({ label: "Autosave integrity Worker" });
  origin = `http://127.0.0.1:${port}`;
  worker = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    detached: true, stdio: "pipe", env: { ...process.env, LAMP_WORKERS_STATE_PATH: statePath, LAMP_VITE_CACHE_DIR: cachePath, LAMP_DISABLE_INSPECTOR: "true" },
  });
  worker.stdout.on("data", chunk => { output += chunk; });
  worker.stderr.on("data", chunk => { output += chunk; });
  await waitForWorker({ origin, child: worker, output: () => output, label: "Autosave integrity Worker" });
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "lamp_session", value: sessionId, url: origin }]);
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
  const response = await context.request.fetch(`${origin}${path}`, { method, ...(body ? { data: body } : {}) });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
const initial = { lifecycle: "Investigating", affectedAudience: "Initial audience", customerImpact: "Service delays", whatStillWorks: "Other services", details: "Private draft", nextUpdateAt: "2027-09-08T14:00:00.000Z" };
async function openIncident() {
  const { component } = await api("/api/app/components", "POST", { groupId: null, name: "Autosave integrity API", description: "", internal: false, displayOrder: 1, note: "" });
  const { incident } = await api("/api/app/incidents", "POST", { title: "Autosave integrity", components: [{ componentId: component.id, state: "Major outage", relationship: "Primary" }] });
  await api(`/api/app/incidents/${incident.id}/draft`, "PUT", initial);
  await page.goto(`${origin}/app/incidents/${incident.id}`);
  await page.getByText("Draft saved", { exact: true }).waitFor();
  return incident;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function assertPrivateUnsaved() {
  assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "Schedule update", exact: true, includeHidden: true }).isEnabled(), false);
  assert.notEqual(await page.locator(".autosave-status").innerText(), "Draft saved");
}

for (const mode of ["delayed response", "delayed request", "reverted edit after lost response"]) {
  test(`serialized autosave preserves latest displayed bytes with ${mode}`, async () => {
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
      await entered.promise;
      await field.fill(latest);
      await page.waitForTimeout(1500); // A later write must not overtake the pending earlier write.
      assert.equal(requests, 1);
      await assertPrivateUnsaved();
      release.resolve();
      await secondEntered.promise;
      await assertPrivateUnsaved();
      assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, "Earlier operator audience");
      releaseSecond.resolve();
      await page.getByText("Draft saved", { exact: true }).waitFor();
      assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, latest);
      assert.equal(await field.inputValue(), latest);
      await page.reload();
      await page.getByText("Draft saved", { exact: true }).waitFor();
      assert.equal(await field.inputValue(), latest);
      if (mode === "delayed request") {
        await page.getByText("Schedule or backdate", { exact: true }).click();
        await page.getByLabel("Scheduled publication date and time").fill("2027-09-08T13:30");
        await page.getByRole("button", { name: "Schedule update", exact: true }).click();
        await page.getByText("Update scheduled. It remains private until its recorded publication time.", { exact: true }).waitFor();
        assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, latest);
      } else {
        await page.getByRole("button", { name: "Publish update", exact: true }).click();
        await page.getByText("Update published. The fixed recipient set is now queued for delivery.", { exact: true }).waitFor();
        assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.updates[0].affectedAudience, latest);
      }
    } finally {
      release.resolve(); releaseSecond.resolve();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

test("a failed current save stays unsaved; reverting repairs uncertain server state", async () => {
  const incident = await openIncident();
  const field = page.locator(".impact-field textarea").first();
  const endpoint = `**/api/app/incidents/${incident.id}/draft`;
  await page.route(endpoint, async route => {
    await route.fetch(); // Lose the acknowledgement after native persistence.
    await route.abort();
  }, { times: 1 });
  await field.fill("Persisted without acknowledgement");
  await page.getByText("Draft save failed", { exact: true }).waitFor();
  await assertPrivateUnsaved();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator(".autosave-status").innerText(), "Draft save failed");
  await field.fill(initial.affectedAudience);
  await page.getByText("Draft saved", { exact: true }).waitFor();
  assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, initial.affectedAudience);
});

test("reverting before debounce restores saved status without a redundant write", async () => {
  const incident = await openIncident();
  const field = page.locator(".impact-field textarea").first();
  const requests = [];
  const record = request => { if (request.method() === "PUT" && request.url().endsWith(`/incidents/${incident.id}/draft`)) requests.push(request); };
  page.on("request", record);
  await field.fill("Transient edit");
  await assertPrivateUnsaved();
  await field.fill(initial.affectedAudience);
  await page.getByText("Draft saved", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), true);
  await page.waitForTimeout(1500);
  page.off("request", record);
  assert.equal(requests.length, 0);
});

test("an applied native template becomes the displayed and saved draft", async () => {
  const incident = await openIncident();
  const field = page.locator(".impact-field textarea").first();
  await page.locator("summary", { hasText: "Update templates" }).click();
  await page.getByLabel("Template name", { exact: true }).fill("Autosave template integrity");
  await page.getByRole("button", { name: "Save template", exact: true }).click();
  await page.getByText("Template saved.", { exact: true }).waitFor();
  await field.fill("Draft to replace with the template");
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page.getByLabel("Saved update template", { exact: true }).selectOption({ label: "Autosave template integrity" });
  await page.getByRole("button", { name: "Apply template", exact: true }).click();
  await page.getByText("Template filled the private draft.", { exact: true }).waitFor();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), initial.affectedAudience);
  assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, initial.affectedAudience);
});

test("manual retry saves the retained draft after a transient transport failure", async () => {
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
    await page.getByText("Draft save failed", { exact: true }).waitFor();
    await assertPrivateUnsaved();
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, initial.affectedAudience);
    await page.waitForTimeout(1500);
    assert.equal(requests, 1, "failure must not start an automatic retry loop");
    assert.equal(await page.getByRole("button", { name: "Retry save", exact: true }).count(), 1, await page.locator(".composer-panel").innerText());
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    assert.equal(await field.inputValue(), "Retain these edits for manual retry");
    await page.getByText("Draft saved", { exact: true }).waitFor();
    assert.equal(requests, 2);
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, "Retain these edits for manual retry");
    assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Schedule update", exact: true, includeHidden: true }).isEnabled(), true);
  } finally { await page.unrouteAll({ behavior: "wait" }); }
});

test("a private-note refresh preserves the original two-second autosave deadline", async t => {
  await assertAutosaveDuringRefresh({ page, api, openIncident, assertPrivateUnsaved, initial }, t);
});

test("queued autosave preserves the latest edit deadline", async t => {
  await assertQueuedAutosaveDeadline({ page, api, openIncident, assertPrivateUnsaved, initial }, t);
});
