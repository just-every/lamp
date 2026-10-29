import assert from "node:assert/strict";
import { openIncidentFollowFixture } from "./incident-follow-fixture.mjs";
import { incidentSubscriberFiles } from "./incident-subscriber-import-flow.mjs";
import { moveInDoor } from "../../helpers/import-notifications.mjs";

/** A separate installation keeps the existing pending-import undo proof intact.
 * Historical source rows stay silent; current native publications stay live. */
export async function importedIncidentLiveFlow(original) {
  const fixture = await openIncidentFollowFixture();
  try {
    await fixture.setIncludeReport(false);
    const send = async (path, body, headers) => fixture.api(path, {
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), headers,
    });
    const moveIn = moveInDoor(send);
    const files = incidentSubscriberFiles(original);
    files.find(row => row.name === "subscribers.json").text = "[]";
    const email = "synthetic-lamp-import-follower@example.test";
    const reviewed = await moveIn.preview({ files });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(reviewed.body.report.counts.subscriber.imported, 1);
    assert.equal(fixture.messagesFor(email).length, 0, "the import preview sends no confirmation or historical update");
    const applied = await moveIn.apply(reviewed.body);
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.job.state, "completed");
    const follower = (await fixture.list()).find(row => row.destination === email);
    assert.equal(follower.state, "pending");
    assert.equal(fixture.messagesFor(email).length, 0, "importing historical updates and their follower sends no replay");
    const incident = (await fixture.api("/api/app/incidents")).body.incidents.find(row => row.id === follower.incident.id);
    assert.ok(incident.updates.some(update => update.isRetroactive), "the followed incident retains imported historical updates");
    assert.equal((await fixture.scope(follower.id)).include_report, 0, "the import snapshots the owner's current report choice");
    const invited = await fixture.post(`/api/app/statuspage-import/jobs/${applied.body.job.id}/send-invitations`);
    assert.equal(invited.status, 200, invited.text);
    assert.equal(invited.body.invites.sent, 1);
    assert.equal(fixture.messagesFor(email).length, 1, "only the explicit owner action sends one invitation");
    await fixture.confirm(email);
    assert.equal((await fixture.list()).find(row => row.id === follower.id).state, "active");

    const components = (await fixture.api("/api/app/components")).body.components;
    const component = components.find(row => row.id === incident.components[0].componentId);
    assert.ok(component);
    const unrelated = await fixture.create(component, "Synthetic Lamp unrelated incident beside imported history");
    const beforeOther = fixture.messagesFor(email).length;
    const otherUpdate = await fixture.publish(unrelated, "Synthetic Lamp unrelated live update beside imported history.");
    assert.equal(fixture.messagesFor(email).length, beforeOther);
    assert.ok(!(await fixture.deliveries(otherUpdate.id)).some(row => row.subscriberId === follower.id), "an imported incident follower never joins another incident's recipient set");

    const next = await fixture.publish(incident, "Synthetic Lamp live update after Statuspage import.");
    assert.ok(fixture.messagesFor(email).some(message => message.text.includes("Synthetic Lamp live update after Statuspage import.")), "historical source rows cannot suppress a later native update");
    assert.ok((await fixture.deliveries(next.id)).some(row => row.subscriberId === follower.id && row.outcome === "delivered"));
    const resolution = await fixture.publish(incident, "Synthetic Lamp delivered resolution after Statuspage import.", "Resolved");
    assert.ok((await fixture.deliveries(resolution.id)).some(row => row.subscriberId === follower.id && row.outcome === "delivered"));
    const ended = await fixture.scope(follower.id);
    assert.equal(ended.resolution_at, resolution.publishedAt, "the later live resolution starts the lifetime even when the incident has historical updates");
    assert.ok(ended.ended_at, "the imported follow ends after its live resolution is delivered");
    const afterResolution = fixture.messagesFor(email).length;
    await fixture.publish(incident, "Synthetic Lamp reopening after imported follow ended.", "Investigating");
    assert.equal(fixture.messagesFor(email).length, afterResolution);
    await fixture.tick(Date.parse(ended.ended_at) + 86_400_000);
    await fixture.erased(email, "an ended imported incident follower is erased from native data and retained import custody within 24 hours");
  } finally {
    await fixture.close();
  }
}
