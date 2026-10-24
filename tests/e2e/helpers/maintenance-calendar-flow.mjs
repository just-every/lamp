import assert from "node:assert/strict";
import ICAL from "ical.js";

// Public management and retained-read doors, using Mozilla's published RFC 5545
// parser rather than accepting a hand-written string as a calendar.
export async function maintenanceCalendarFlow({ appFetch, pageUrl, eventually, componentId }) {
  const title = "synthetic-lamp-007 ;,\\\n" + "é".repeat(90);
  const startsAt = new Date(Date.now() + 9 * 60 * 60_000).toISOString();
  const endsAt = new Date(Date.now() + 10 * 60 * 60_000).toISOString();
  async function create(input) {
    const response = await appFetch("/api/app/maintenance", { method: "POST", body: JSON.stringify(input) });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).maintenance;
  }
  const item = await create({ affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title, startsAt, endsAt, componentIds: [componentId], autoStart: false });
  const uid = `lamp-maintenance-${item.id}@lamp`;
  async function read() {
    const response = await fetch(`${pageUrl}/maintenance.ics`), body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/calendar/);
    assert.ok(body.endsWith("\r\n"));
    assert.ok(!body.replaceAll("\r\n", "").includes("\n"), "calendar uses CRLF exclusively");
    assert.ok(body.split("\r\n").every(line => Buffer.byteLength(line) <= 75), "folded content lines are at most 75 octets");
    const parsed = new ICAL.Component(ICAL.parse(body));
    assert.equal(parsed.name, "vcalendar");
    assert.equal(parsed.getFirstPropertyValue("version"), "2.0");
    const events = parsed.getAllSubcomponents("vevent");
    for (const event of events) {
      const parsedEvent = new ICAL.Event(event);
      assert.ok(parsedEvent.uid); assert.ok(parsedEvent.startDate); assert.ok(parsedEvent.endDate);
    }
    return { body, events, event: events.find(event => event.getFirstPropertyValue("uid") === uid) };
  }
  let calendar = await eventually(read, value => Boolean(value.event), "the scheduled RFC 5545 event");
  assert.equal(calendar.event.getFirstPropertyValue("summary"), title);
  assert.equal(calendar.event.getFirstPropertyValue("sequence"), 0);
  assert.equal(calendar.event.getFirstPropertyValue("status"), "CONFIRMED");
  assert.equal(new ICAL.Event(calendar.event).startDate.toJSDate().getTime(), Math.floor(Date.parse(startsAt) / 1000) * 1000);
  const shifted = { startsAt: new Date(Date.parse(startsAt) + 3600_000).toISOString(), endsAt: new Date(Date.parse(endsAt) + 3600_000).toISOString() };
  assert.equal((await appFetch(`/api/app/maintenance/${item.id}/window`, { method: "PUT", body: JSON.stringify(shifted) })).status, 200);
  calendar = await eventually(read, value => value.event?.getFirstPropertyValue("sequence") === 1, "rescheduled event revision");
  assert.equal(calendar.event.getFirstPropertyValue("uid"), uid);
  assert.equal(new ICAL.Event(calendar.event).startDate.toJSDate().getTime(), Math.floor(Date.parse(shifted.startsAt) / 1000) * 1000);
  assert.equal((await appFetch(`/api/app/maintenance/${item.id}/start`, { method: "POST" })).status, 200);
  // In-progress maintenance remains the same published calendar event.
  assert.equal((await read()).event.getFirstPropertyValue("uid"), uid);
  assert.equal((await appFetch(`/api/app/maintenance/${item.id}/complete`, { method: "POST" })).status, 200);
  await eventually(read, value => !value.event, "completed event leaves the active calendar");
  // Cancel a separate scheduled window; active windows cannot be canceled.
  const cancelled = await create({ affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title: "synthetic-lamp-008", startsAt, endsAt, componentIds: [componentId] });
  assert.equal((await appFetch(`/api/app/maintenance/${cancelled.id}/cancel`, { method: "POST" })).status, 200);
  calendar = await eventually(read, value => value.events.some(event => event.getFirstPropertyValue("uid") === `lamp-maintenance-${cancelled.id}@lamp` && event.getFirstPropertyValue("status") === "CANCELLED"), "canceled event status");
  const privateResponse = await appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ groupId: null, name: "synthetic-lamp-007-private", description: "", internal: true, displayOrder: 1000, note: "" }) });
  assert.equal(privateResponse.status, 201);
  const privateComponent = (await privateResponse.json()).component;
  const hidden = await create({ affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title: "synthetic-lamp-007-hidden-window", startsAt, endsAt, componentIds: [privateComponent.id] });
  // Wait for a known public change after the hidden window, so a prior snapshot
  // cannot make the privacy assertion pass merely because publication is pending.
  const barrier = await create({ affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.", title: "synthetic-lamp-007-barrier", startsAt, endsAt, componentIds: [componentId, privateComponent.id] });
  calendar = await eventually(read, value => value.events.some(event => event.getFirstPropertyValue("uid") === `lamp-maintenance-${barrier.id}@lamp`), "privacy proof generation");
  assert.ok(!calendar.body.includes(hidden.id)); assert.ok(!calendar.body.includes(hidden.title));
  const decodedText = calendar.events.flatMap(event => [event.getFirstPropertyValue("summary"), event.getFirstPropertyValue("description")]).join("\n");
  assert.ok(!decodedText.includes(privateComponent.name), "unfolded event text excludes internal component names");
  assert.ok(!decodedText.includes(privateComponent.id), "unfolded event text excludes internal component ids");
}
