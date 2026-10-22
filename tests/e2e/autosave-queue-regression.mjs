import assert from "node:assert/strict";
import { incidentComposer } from "./helpers/incident-composer.mjs";

// Hold only an acknowledgement from a real native PUT. The latest edit must
// keep its original debounce while the earlier write retains serialization.
export async function assertQueuedAutosaveDeadline({ page, api, openIncident, assertPrivateUnsaved, initial }, t) {
  const incident = await openIncident();
  const endpoint = `/api/app/incidents/${incident.id}/draft`;
  const field = incidentComposer(page).audience;
  const earlier = "Earlier audience awaiting its native acknowledgement";
  const latest = "Latest audience edited while the earlier save is pending";
  const writes = [];
  const timings = {};
  let releaseFirst, enteredFirst;
  const release = new Promise(resolve => { releaseFirst = resolve; });
  const entered = new Promise(resolve => { enteredFirst = resolve; });
  const onRequest = request => {
    if (request.method() === "PUT" && request.url().endsWith(endpoint)) writes.push({ at: Date.now(), body: JSON.parse(request.postData()) });
  };
  const onResponse = response => {
    if (response.request().method() === "PUT" && response.url().endsWith(endpoint)) {
      const body = JSON.parse(response.request().postData());
      timings[body.affectedAudience === earlier ? "earlierAcknowledged" : "latestAcknowledged"] = Date.now();
      assert.equal(response.status(), 200);
    }
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  let handled = false; // Installed until unrouteAll: a one-shot route can strand a paused request.
  await page.route(`**${endpoint}`, async route => {
    if (handled) return route.continue();
    handled = true;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    timings.earlierPersisted = Date.now();
    enteredFirst();
    await release;
    await route.fulfill({ response });
  });
  try {
    await field.fill(earlier);
    await entered;
    await field.fill("Intermediate audience coalesced into the latest edit");
    await page.evaluate(() => {
      window.queuedAutosaveProbe = {};
      document.querySelector('[aria-label="Who is affected"]').addEventListener("input", () => {
        window.queuedAutosaveProbe.finalEdit = Date.now();
      }, { once: true });
      const observer = new MutationObserver(() => {
        if (window.queuedAutosaveProbe.finalEdit && document.querySelector(".autosave-status")?.textContent === "Draft saved") {
          window.queuedAutosaveProbe.saved = Date.now();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await field.fill(latest);
    timings.finalEdit = await page.evaluate(() => window.queuedAutosaveProbe.finalEdit);
    await assertPrivateUnsaved();
    assert.equal((await api(`/api/app/incidents/${incident.id}`)).incident.draft.affectedAudience, earlier);
    await page.waitForTimeout(Math.max(0, timings.finalEdit + 1000 - Date.now()));
    assert.equal(writes.length, 1, "the latest edit must not overtake the unacknowledged write");
    releaseFirst();
    let deadlineError;
    await page.getByText("Draft saved", { exact: true }).waitFor({ timeout: Math.max(1, timings.finalEdit + 2000 - Date.now()) }).catch(error => { deadlineError = error; });
    await page.getByText("Draft saved", { exact: true }).waitFor();
    Object.assign(timings, await page.evaluate(() => window.queuedAutosaveProbe));
    timings.writes = writes;
    timings.elapsedToSaved = timings.saved - timings.finalEdit;
    timings.deadlinePassed = !deadlineError;
    t.diagnostic(JSON.stringify(timings));
    assert.equal(writes.length, 2, "pending edits must coalesce into one latest write");
    assert.deepEqual(writes[1].body, { ...initial, affectedAudience: latest, componentChanges: [] });
    assert.ok(writes[1].at >= timings.earlierAcknowledged, "writes must remain serialized");
    assert.ok(timings.saved >= timings.latestAcknowledged, "Draft saved must follow the latest native acknowledgement");
    const stored = (await api(`/api/app/incidents/${incident.id}`)).incident.draft;
    for (const [key, value] of Object.entries(writes[1].body)) assert.deepEqual(stored[key], value);
    await page.reload();
    await page.getByText("Draft saved", { exact: true }).waitFor();
    assert.equal(await field.inputValue(), latest);
    assert.ok(!deadlineError && timings.elapsedToSaved < 2000, "waiting for an earlier save must count toward the latest edit's two-second deadline");
  } finally {
    releaseFirst();
    page.off("request", onRequest);
    page.off("response", onResponse);
    await page.unrouteAll({ behavior: "wait" });
  }
}
