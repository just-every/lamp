import assert from "node:assert/strict";
import { moveInDoor } from "../../helpers/import-notifications.mjs";

/** Synthetic documented Statuspage responses, imported through the same owner
 * upload/review/apply doors as Move in. Historical state is never written by SQL. */
export async function followUpsImport(fixture) {
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const resolved = new Date(Date.parse(old) + 3_600_000).toISOString();
  const componentId = "synthetic-lamp-source-component-1";
  const sourceIncident = number => ({
    id: `synthetic-lamp-source-incident-${number}`, name: `Synthetic Lamp report ${number}`,
    status: "resolved", impact: "major", created_at: old, resolved_at: resolved,
    components: [{ id: componentId }], incident_updates: [
      { id: `synthetic-lamp-source-update-${number}-1`, status: "investigating", body: "Customer requests failed.", created_at: old,
        affected_components: [{ code: componentId, name: "Synthetic Lamp imported API", old_status: "operational", new_status: "major_outage" }] },
      { id: `synthetic-lamp-source-update-${number}-2`, status: "resolved", body: "Requests recovered.", created_at: resolved,
        affected_components: [{ code: componentId, name: "Synthetic Lamp imported API", old_status: "major_outage", new_status: "operational" }] },
    ],
  });
  const files = Object.entries({
    "page.json": { id: "synthetic-lamp-source-page-1", name: "Synthetic Lamp source", viewers_must_be_team_members: false, ip_restrictions: null },
    "page-access-groups.json": [],
    "component-groups.json": [],
    "components.json": [{ id: componentId, name: "Synthetic Lamp imported API", group: false, group_id: null, position: 1, status: "operational", created_at: old }],
    "incidents.json": [sourceIncident(1), sourceIncident(2)],
    "incidents-scheduled.json": [],
    "subscribers.json": [{ id: "synthetic-lamp-source-subscriber-1", mode: "email", email: "synthetic-lamp-invited@example.test", components: [componentId], created_at: old }],
  }).map(([name, value]) => ({ name, text: JSON.stringify(value) }));
  const moveIn = moveInDoor(async (path, json, headers) => fixture.api(path, {
    ...(json ? { method: "POST", body: JSON.stringify(json) } : {}), headers,
  }));
  const reviewed = await moveIn.preview({ files });
  assert.equal(reviewed.status, 200, reviewed.text ?? JSON.stringify(reviewed.body));
  const applied = await moveIn.apply(reviewed.body);
  assert.equal(applied.status, 200, applied.text ?? JSON.stringify(applied.body));
  assert.equal(applied.body.job.state, "completed");
  const incidents = (await fixture.api("/api/app/incidents")).body.incidents;
  const reports = [1, 2].map(number => {
    const incident = incidents.find(row => row.title === `Synthetic Lamp report ${number}`);
    assert.ok(incident, "historical report obligation has a surviving native incident");
    return incident;
  });
  const subscriber = (await fixture.api("/api/app/subscribers?limit=100")).body.subscribers.find(row => row.destination === "synthetic-lamp-invited@example.test");
  assert.equal(subscriber?.state, "pending");
  return { reports, subscriber, jobId: applied.body.job.id, resolved };
}
