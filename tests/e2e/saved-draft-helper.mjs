import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { incidentComposer } from "./helpers/incident-composer.mjs";

// A datetime-local control contains a wall-clock value, not an ISO instant.
// Compare it with the saved instant expressed in the configured page zone.
export function configuredDateTimeInput(iso, timezone) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const part = kind => parts.find(entry => entry.type === kind).value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

// A semantic journey must identify the current write before using its draft.
// UPDATE-005 and autosave-integrity retain their separate strict 2,000 ms gates.
export async function saveAndConfirmDraft({ page, appFetch, incidentId, expected, edit, t }) {
  const endpoint = `/api/app/incidents/${incidentId}/draft`;
  // These text-edit journeys leave the new staged component choices unchanged.
  const expectedRequest = { ...expected, componentChanges: [] };
  const startedAt = Date.now();
  const acknowledged = page.waitForResponse((response) => {
    const request = response.request();
    return new URL(response.url()).pathname === endpoint
      && request.method() === "PUT"
      && isDeepStrictEqual(request.postDataJSON(), expectedRequest);
  }, { timeout: 10_000 });
  const [response] = await Promise.all([acknowledged, edit()]);
  const acknowledgement = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(acknowledgement));
  const { draft } = acknowledgement;
  const acknowledgedAt = Date.now();
  const fields = (record) => Object.fromEntries(Object.keys(expected).map((key) => [key, record[key]]));
  assert.equal(draft.incidentId, incidentId);
  assert.deepEqual(fields(draft), expected, "the native acknowledgement must contain this exact draft");
  assert.deepEqual(draft.componentChanges, [], "text edits must not stage component changes");

  const stored = await appFetch(`/api/app/incidents/${incidentId}`);
  const record = await stored.json();
  assert.equal(stored.status, 200, JSON.stringify(record));
  const { incident } = record;
  assert.equal(incident.draft.id, draft.id);
  assert.equal(incident.draft.updatedAt, draft.updatedAt);
  assert.deepEqual(fields(incident.draft), expected, "the acknowledged draft must be durably readable");
  assert.deepEqual(incident.draft.componentChanges, [], "the stored draft must retain the unchanged component choices");

  await page.getByText("Draft saved", { exact: true }).waitFor({ timeout: 10_000 });
  const composer = incidentComposer(page);
  const displayed = {
    lifecycle: await composer.status(),
    affectedAudience: await composer.audience.inputValue(),
    customerImpact: await composer.impact.inputValue(),
    whatStillWorks: await composer.stillWorks.inputValue(),
    details: await composer.details.inputValue(),
    nextUpdateAt: await composer.nextUpdate.count() ? await composer.nextUpdate.inputValue() : "",
  };
  const { settings } = await (await appFetch("/api/app/page-settings")).json();
  assert.deepEqual(displayed, { ...expected, nextUpdateAt: configuredDateTimeInput(expected.nextUpdateAt, settings.timezone) }, "Saved must describe the current displayed draft in the configured page zone");
  const publishable = Boolean(expected.affectedAudience.trim() && expected.customerImpact.trim() && (expected.lifecycle === "Resolved" || expected.nextUpdateAt) && incident.components.some(component => component.componentId));
  assert.equal(await composer.publish.isEnabled(), publishable, "Only a complete acknowledged draft may publish");
  t.diagnostic(JSON.stringify({ phase: "durable draft confirmed", incidentId, startedAt, acknowledgedAt, confirmedAt: Date.now(), expected }));
}
