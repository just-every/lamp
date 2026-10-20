import assert from "node:assert/strict";
import { configuredDateTimeInput } from "./saved-draft-helper.mjs";

// Delay only delivery of a real native GET, so a private-note refresh overlaps
// the draft debounce without changing either response bytes or write behavior.
export async function assertAutosaveDuringRefresh({ page, api, openIncident, assertPrivateUnsaved, initial }, t) {
  const incident = await openIncident();
  const endpoint = `/api/app/incidents/${incident.id}`;
  const field = page.locator(".impact-field textarea").first();
  const audience = "Latest audience while the private note refresh is pending";
  const note = "Native internal note overlapping an unsaved draft";
  const timings = {};
  let releaseRefresh, refreshEntered;
  const released = new Promise(resolve => { releaseRefresh = resolve; });
  const entered = new Promise(resolve => { refreshEntered = resolve; });
  const recordRequest = request => {
    if (request.method() === "PUT" && request.url().endsWith(`${endpoint}/draft`)) {
      timings.putDispatched = Date.now();
      timings.putBytes = JSON.parse(request.postData());
    }
  };
  const recordResponse = response => {
    if (response.request().method() === "GET" && response.url().endsWith(endpoint) && !timings.refreshReceived) {
      timings.refreshReceived = Date.now();
    }
    if (response.request().method() === "PUT" && response.url().endsWith(`${endpoint}/draft`)) {
      timings.putAcknowledged = Date.now();
      timings.putStatus = response.status();
    }
  };
  page.on("request", recordRequest);
  page.on("response", recordResponse);
  await page.evaluate(() => {
    window.autosaveRefreshProbe = {};
    document.querySelector(".impact-field textarea").addEventListener("input", () => {
      window.autosaveRefreshProbe.finalEdit = Date.now();
    }, { once: true });
    const observer = new MutationObserver(() => {
      if (document.querySelector(".autosave-status")?.textContent === "Draft saved" && window.autosaveRefreshProbe.finalEdit) {
        window.autosaveRefreshProbe.saved = Date.now();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  let handled = false; // Installed until unrouteAll: a one-shot route can strand a paused request.
  await page.route(`**${endpoint}`, async route => {
    if (handled) return route.continue();
    handled = true;
    assert.equal(route.request().method(), "GET");
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    refreshEntered();
    await released;
    timings.refreshDelivered = Date.now();
    await route.fulfill({ response });
  });
  try {
    await page.getByLabel("Internal note").fill(note);
    await page.getByRole("button", { name: "Save internal note", exact: true }).click();
    await entered;
    await page.getByText("Internal note saved.", { exact: true }).waitFor();
    await field.fill(audience);
    timings.finalEdit = await page.evaluate(() => window.autosaveRefreshProbe.finalEdit);
    await assertPrivateUnsaved();
    // Deliver the held refresh while this draft is unsaved. Do not assume a
    // particular debounce duration: faster autosaves can finish within a second.
    releaseRefresh();
    let deadlineError;
    await page.getByText("Draft saved", { exact: true })
      .waitFor({ timeout: Math.max(1, timings.finalEdit + 2000 - Date.now()) })
      .catch(error => { deadlineError = error; });
    // Preserve timing and persisted-byte evidence even when the deadline fails.
    await page.getByText("Draft saved", { exact: true }).waitFor();
    Object.assign(timings, await page.evaluate(() => window.autosaveRefreshProbe));
    t.diagnostic(JSON.stringify({ phase: "acknowledged", ...timings, elapsedToSaved: timings.saved - timings.finalEdit, deadlinePassed: !deadlineError }));
    await page.unrouteAll({ behavior: "wait" });
    const stored = (await api(endpoint)).incident;
    timings.storedDraft = stored.draft;
    assert.equal(stored.internalNotes[0].body, note);
    assert.deepEqual(timings.putBytes, { ...initial, affectedAudience: audience, componentChanges: [] });
    for (const [key, value] of Object.entries(timings.putBytes)) assert.deepEqual(stored.draft[key], value);
    await page.reload();
    await page.getByText("Draft saved", { exact: true }).waitFor();
    timings.reloadedDraft = {
      lifecycle: await page.getByLabel("Status").inputValue(),
      affectedAudience: await field.inputValue(),
      customerImpact: await page.locator("label", { hasText: "What is the impact" }).locator("textarea").inputValue(),
      whatStillWorks: await page.locator("label", { hasText: "What still works" }).locator("textarea").inputValue(),
      details: await page.locator("label", { hasText: "Additional details" }).locator("textarea").inputValue(),
      nextUpdateAt: await page.getByLabel("Next update date and time").inputValue(),
    };
    t.diagnostic(JSON.stringify({ ...timings, elapsedToSaved: timings.saved - timings.finalEdit, deadlinePassed: !deadlineError }));
    const { settings } = await api("/api/app/page-settings");
    const { componentChanges, ...textFields } = timings.putBytes;
    assert.deepEqual((await api(endpoint)).incident.draft.componentChanges, componentChanges, "reload retains the acknowledged staged choices");
    assert.deepEqual(timings.reloadedDraft, { ...textFields, nextUpdateAt: configuredDateTimeInput(timings.putBytes.nextUpdateAt, settings.timezone) }, "reload restores every draft field, displaying the saved instant in the page zone");
    assert.equal(timings.putStatus, 200);
    assert.ok(timings.refreshDelivered > timings.finalEdit && timings.refreshReceived < timings.putDispatched);
    assert.ok(timings.saved >= timings.putAcknowledged, "Saved must follow the native PUT acknowledgement");
    assert.ok(!deadlineError && timings.saved - timings.finalEdit < 2000, "an unrelated incident refresh must not postpone saving beyond two seconds");
  } finally {
    releaseRefresh();
    page.off("request", recordRequest);
    page.off("response", recordResponse);
    await page.unrouteAll({ behavior: "wait" });
  }
}
