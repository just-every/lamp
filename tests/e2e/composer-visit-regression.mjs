import assert from "node:assert/strict";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Delay a real native response at the network edge, without replacing its data
// or changing the server's conditional writes/publication transaction.
async function holdResponse(page, endpoint, held, expectedStatus, times = 1) {
  const entered = deferred(), release = deferred(), finished = deferred();
  held.push(release);
  // Installed until unrouteAll: removing a one-shot route can strand a paused request.
  let count = 0;
  await page.route(typeof endpoint === "string" ? `**${endpoint}` : endpoint, async route => {
    if (++count > times) return route.continue();
    try {
      const response = await route.fetch();
      assert.ok(response.ok(), `Native response: ${response.status()}`);
      if (expectedStatus !== undefined) assert.equal(response.status(), expectedStatus);
      entered.resolve();
      await release.promise;
      // A page that abandoned this request (its visit unmounted) has already
      // settled the route; nothing remains to deliver.
      await route.fulfill({ response }).catch(error => { if (!/Route is already handled/.test(error.message)) throw error; });
    } finally { finished.resolve(); }
  });
  return { entered: entered.promise, release: release.resolve, finished: finished.promise };
}

export async function assertComposerVisitIsolation({ page, api, openIncident, initial, waitForAutosave }) {
  const a = await openIncident();
  const { incident: b } = await api("/api/app/incidents", "POST", {
    title: "Separate editing visit",
    components: [{ componentId: a.components[0].componentId, state: "Degraded performance", relationship: "Primary" }],
  });
  const bDraft = { ...initial, affectedAudience: "B native audience" };
  await api(`/api/app/incidents/${b.id}/draft`, "PUT", bDraft);
  const field = page.getByLabel(/Who is affected/);
  const saved = () => page.locator(".autosave-status.is-saved").waitFor();
  const read = async id => (await api(`/api/app/incidents/${id}`)).incident;
  const documentStarted = await page.evaluate(() => performance.timeOrigin);

  // Establish real browser history A → list → B, then traverse directly between
  // A and B. Skipping the list is essential: the detail route must change params
  // in one live app, not gain isolation from a full document or list unmount.
  // The operator loader is one /app match: a navigation that starts while its
  // reload is in flight reuses that reload, and the visit then renders from the
  // previous incident's snapshot. Each traversal waits for the last loader first.
  const loaders = new Set();
  const track = request => { if (request.url().includes("/_serverFn/")) loaders.add(request); };
  const untrack = request => loaders.delete(request);
  page.on("request", track); page.on("requestfinished", untrack); page.on("requestfailed", untrack);
  const loadersSettled = async phase => {
    const deadline = Date.now() + 15_000;
    while (loaders.size) {
      assert.ok(Date.now() < deadline, `The operator loader did not settle ${phase}.`);
      await page.waitForTimeout(50);
    }
  };
  await page.locator('.back-link').click();
  await page.locator(`a[href="/app/incidents/${b.id}"]`).click();
  await saved();
  const traverse = async (delta, id) => {
    await loadersSettled(`before traversing to ${id}`);
    await page.evaluate(delta => history.go(delta), delta);
    await page.waitForURL(url => url.pathname === `/app/incidents/${id}`);
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentStarted);
  };
  await traverse(-2, a.id);
  await saved();

  const held = [];
  try {
    const oldSave = await holdResponse(page, `/api/app/incidents/${a.id}/draft`, held);
    await field.fill("A write from the previous visit");
    await waitForAutosave(oldSave.entered, "the previous visit write");
    assert.equal((await read(a.id)).draft.affectedAudience, "A write from the previous visit");
    // B's visit is read by the operator loader, and by the detail page itself
    // when it renders before that loader settles. Hold both so B stays loading.
    const loaderB = await holdResponse(page, url => url.pathname.startsWith("/_serverFn/") && decodeURIComponent(url.search).includes(`/app/incidents/${b.id}`), held);
    // Development mounts the visit twice; hold every read of B, not only the first.
    const loadingB = await holdResponse(page, `/api/app/incidents/${b.id}`, held, undefined, 2);
    await traverse(2, b.id);
    await waitForAutosave(loadingB.entered, "the next incident read");
    assert.equal(await field.count(), 0, "B loading must not expose A's editable fields");
    assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).count(), 0);
    loadingB.release();
    loaderB.release();
    await saved();
    assert.equal(await field.inputValue(), bDraft.affectedAudience);
    await field.fill("B independent saved edit");
    await saved();
    assert.equal((await read(b.id)).draft.affectedAudience, "B independent saved edit");

    await traverse(-2, a.id);
    await saved();
    assert.equal(await field.inputValue(), "A write from the previous visit", "a started native write may commit");
    await field.fill("A fresh visit owns this draft");
    await saved(); // The old visit's activeSave must not block this visit.
    oldSave.release();
    await waitForAutosave(oldSave.finished, "the obsolete save acknowledgement");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await field.inputValue(), "A fresh visit owns this draft");
    await field.fill("A fresh visit keeps its acknowledged version");
    await saved();
    assert.equal((await read(a.id)).draft.affectedAudience, "A fresh visit keeps its acknowledged version");

    // Publication really commits, but its subsequent GET has already captured
    // the empty next draft. A new visit can edit that draft before the old GET
    // arrives; neither those bytes nor its acknowledged version may be reset.
    const oldPublication = await holdResponse(page, `/api/app/incidents/${a.id}`, held);
    await page.getByRole("button", { name: "Publish update", exact: true }).click();
    await waitForAutosave(oldPublication.entered, "the publication follow-up read");
    assert.equal((await read(a.id)).draft, null);
    await traverse(2, b.id);
    await saved();
    assert.equal(await field.inputValue(), "B independent saved edit");
    await traverse(-2, a.id);
    await page.locator(".autosave-status.is-empty").waitFor();
    await field.fill("The next update has a new audience");
    await page.getByLabel(/What is the impact/).fill("Recovery is progressing.");
    await page.getByLabel("Next update date and time").fill("2027-09-08T16:00");
    await saved();
    oldPublication.release();
    await waitForAutosave(oldPublication.finished, "the obsolete publication read");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await field.inputValue(), "The next update has a new audience");
    assert.equal(await page.getByLabel(/What is the impact/).inputValue(), "Recovery is progressing.");
    await field.fill("The new publication draft remains editable");
    await saved();
    assert.equal((await read(a.id)).draft.affectedAudience, "The new publication draft remains editable");
    assert.equal((await read(a.id)).updates.length, 1);
    assert.equal((await read(b.id)).draft.affectedAudience, "B independent saved edit");
    await page.reload();
    await saved();
    assert.equal(await field.inputValue(), "The new publication draft remains editable");
    await assertConsumedUpdateNoteIsolation({ page, read, incidentId: a.id, held, waitForAutosave, saved, field });
  } finally {
    for (const release of held) release.resolve();
    await page.unrouteAll({ behavior: "wait" });
    page.off("request", track); page.off("requestfinished", untrack); page.off("requestfailed", untrack);
  }
}

async function assertConsumedUpdateNoteIsolation({ page, read, incidentId, held, waitForAutosave, saved, field }) {
  const endpoint = `/api/app/incidents/${incidentId}`;
  const note = page.getByLabel("Internal note", { exact: true });
  const controls = page.locator(".incident-operator-controls");
  const documentStarted = await page.evaluate(() => performance.timeOrigin);
  const activity = { notes: 0, drafts: 0, reads: 0 };
  const recordRequest = request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === `${endpoint}/internal-notes`) activity.notes += 1;
    if (request.method() === "PUT" && path === `${endpoint}/draft`) activity.drafts += 1;
    if (request.method() === "GET" && path === endpoint) activity.reads += 1;
  };
  page.on("request", recordRequest);
  try {
    const before = await read(incidentId);
    const oldNote = await holdResponse(page, `${endpoint}/internal-notes`, held, 201);
    await note.fill("Operator context saved before publication");
    await page.getByRole("button", { name: "Save internal note", exact: true }).click();
    await waitForAutosave(oldNote.entered, "the committed private note");
    const committed = await read(incidentId);
    const originalNote = committed.internalNotes.find(entry => !before.internalNotes.some(previous => previous.id === entry.id));
    assert.ok(originalNote);
    assert.equal(originalNote.body, "Operator context saved before publication");
    assert.equal(committed.internalNotes.length, before.internalNotes.length + 1);
    assert.deepEqual(committed.draft, before.draft);
    const published = page.waitForResponse(response => response.url().endsWith(`${endpoint}/publish`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Publish update", exact: true }).click();
    assert.equal((await published).status(), 200);
    await page.locator(".autosave-status.is-empty").waitFor();
    assert.equal(await field.inputValue(), "");
    const afterPublish = await read(incidentId);
    assert.equal(afterPublish.draft, null);
    assert.equal(afterPublish.updates.length, before.updates.length + 1);
    assert.equal(afterPublish.updates.find(update => update.id === before.draft.id).affectedAudience, before.draft.affectedAudience);
    assert.equal(await page.locator(".timeline li").count(), afterPublish.updates.length);

    await field.fill("Current audience after the private action's update was consumed");
    await page.getByLabel(/What is the impact/).fill("Recovery continues for the current audience.");
    await page.getByLabel("Next update date and time").fill("2027-09-08T17:00");
    await saved();
    const current = await read(incidentId);
    await note.fill("Pending context for the next public update");
    await page.getByRole("checkbox", { name: "Webhook", exact: true }).check();
    const statuses = page.locator(".incident-operator-controls [role=status], .incident-operator-controls [role=alert], .publication-message, .autosave-status");
    const priorStatus = await statuses.allTextContents();
    const priorActivity = { ...activity };
    oldNote.release();
    await waitForAutosave(oldNote.finished, "the obsolete private note acknowledgement");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentStarted);
    assert.equal(await note.inputValue(), "Pending context for the next public update");
    assert.equal(await field.inputValue(), current.draft.affectedAudience);
    assert.equal(await page.getByLabel(/What is the impact/).inputValue(), current.draft.customerImpact);
    assert.equal(await page.getByLabel("Lifecycle").inputValue(), current.draft.lifecycle);
    assert.equal(await page.getByLabel("Next update date and time").inputValue(), "2027-09-08T17:00");
    assert.equal(await page.getByRole("checkbox", { name: "Email", exact: true }).isChecked(), true);
    assert.equal(await page.getByRole("checkbox", { name: "Webhook", exact: true }).isChecked(), true);
    assert.deepEqual(await statuses.allTextContents(), priorStatus);
    assert.deepEqual(activity, priorActivity, "obsolete success cannot refresh or write the next update");
    assert.equal(activity.notes, 1);
    assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), true);
    assert.deepEqual((await read(incidentId)).draft, current.draft);
    assert.equal((await read(incidentId)).internalNotes.filter(entry => entry.id === originalNote.id).length, 1);

    const finalSave = page.waitForResponse(response => response.url().endsWith(`${endpoint}/draft`) && response.request().method() === "PUT");
    await field.fill("The next draft keeps its usable acknowledged version");
    const acknowledged = await finalSave;
    assert.equal(acknowledged.status(), 200);
    assert.ok(Boolean(acknowledged.request().headers()["if-match"]?.trim()), "save supplies an opaque draft precondition");
    await saved();
    await page.reload();
    await saved();
    assert.equal(await field.inputValue(), "The next draft keeps its usable acknowledged version");
    const reloaded = await read(incidentId);
    assert.equal(reloaded.draft.affectedAudience, await field.inputValue());
    assert.deepEqual(reloaded.updates, current.updates);
    assert.deepEqual(reloaded.internalNotes, committed.internalNotes);
    assert.equal(reloaded.internalNotes.filter(entry => entry.id === originalNote.id).length, 1);
    assert.equal(await controls.locator(".incident-note-list article").count(), reloaded.internalNotes.length);
  } finally { page.off("request", recordRequest); }
}
