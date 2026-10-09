import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

// A semantic journey must identify the current write before using its draft.
// UPDATE-005 and autosave-integrity retain their separate strict 2,000 ms gates.
export async function saveAndConfirmDraft({ page, appFetch, incidentId, expected, edit, t }) {
  const endpoint = `/api/app/incidents/${incidentId}/draft`;
  const startedAt = Date.now();
  const acknowledged = page.waitForResponse((response) => {
    const request = response.request();
    return new URL(response.url()).pathname === endpoint
      && request.method() === "PUT"
      && isDeepStrictEqual(request.postDataJSON(), expected);
  }, { timeout: 10_000 });
  const [response] = await Promise.all([acknowledged, edit()]);
  const acknowledgement = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(acknowledgement));
  const { draft } = acknowledgement;
  const acknowledgedAt = Date.now();
  const fields = (record) => Object.fromEntries(Object.keys(expected).map((key) => [key, record[key]]));
  assert.equal(draft.incidentId, incidentId);
  assert.deepEqual(fields(draft), expected, "the native acknowledgement must contain this exact draft");

  const stored = await appFetch(`/api/app/incidents/${incidentId}`);
  const record = await stored.json();
  assert.equal(stored.status, 200, JSON.stringify(record));
  const { incident } = record;
  assert.equal(incident.draft.id, draft.id);
  assert.equal(incident.draft.updatedAt, draft.updatedAt);
  assert.deepEqual(fields(incident.draft), expected, "the acknowledged draft must be durably readable");

  await page.getByText("Draft saved", { exact: true }).waitFor({ timeout: 10_000 });
  const displayed = {
    lifecycle: await page.getByLabel("Lifecycle").inputValue(),
    affectedAudience: await page.locator("label", { hasText: "Who is affected" }).locator("textarea").inputValue(),
    customerImpact: await page.locator("label", { hasText: "What is the impact" }).locator("textarea").inputValue(),
    whatStillWorks: await page.locator("label", { hasText: "What still works" }).locator("textarea").inputValue(),
    details: await page.locator("label", { hasText: "Additional details" }).locator("textarea").inputValue(),
    nextUpdateAt: await page.getByLabel("Next update date and time").evaluate((input) => input.value ? new Date(input.value).toISOString() : null),
  };
  assert.deepEqual(displayed, expected, "Saved must describe the current displayed draft");
  assert.equal(await page.getByRole("button", { name: "Publish update", exact: true }).isEnabled(), true);
  t.diagnostic(JSON.stringify({ phase: "durable draft confirmed", incidentId, startedAt, acknowledgedAt, confirmedAt: Date.now(), expected }));
}
