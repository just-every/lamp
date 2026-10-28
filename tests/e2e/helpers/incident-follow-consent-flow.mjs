import assert from "node:assert/strict";

const DAY = 86_400_000;

/** Address-wide anti-bomb and expiry reuse native subscriber authority. */
export async function incidentFollowConsentFlow(fixture, incident, other) {
  const { subscribe, messagesFor, list, scope, tick, raw, api } = fixture;
  const pendingEmail = "synthetic-lamp-follow-pending-window@example.test";
  assert.equal((await subscribe(incident.id, { email: pendingEmail })).status, 202);
  assert.equal((await subscribe(other.id, { email: pendingEmail })).status, 202);
  assert.equal(messagesFor(pendingEmail).length, 1, "two incidents share the existing one-confirmation-per-address 24-hour allowance");
  const pending = (await list()).filter(row => row.destination === pendingEmail);
  assert.equal(pending.length, 2, "one address can hold distinct incident subscriptions");
  assert.ok(pending.every(row => row.state === "pending"));
  const expiresAt = Math.max(...pending.map(row => Date.parse(row.createdAt))) + 3 * DAY;
  await tick(expiresAt + 1);
  await fixture.erased(pendingEmail, "unconfirmed incident subscriptions expire after the shared 72-hour pending window");

  await fixture.setIncludeReport(false);
  const shared = "synthetic-lamp-follow-shared-address@example.test";
  assert.equal((await subscribe(incident.id, { email: shared })).status, 202);
  await fixture.confirm(shared);
  const following = (await list()).find(row => row.destination === shared);
  const pageSubscription = await raw(`${fixture.origin}/subscribe`, { method: "POST", headers: { Origin: fixture.origin, Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.240" }, body: new URLSearchParams({ email: shared }).toString() });
  assert.equal(pageSubscription.status, 202);
  const coexist = (await list()).filter(row => row.destination === shared);
  assert.equal(coexist.length, 2, "page and incident scopes can coexist at the same address");
  const pageRow = coexist.find(row => !row.incident);
  assert.ok(pageRow, "the independent page subscription is retained");
  await fixture.publish(incident, "Synthetic Lamp shared-address incident resolution.", "Resolved");
  const endedAt = Date.parse((await scope(following.id)).ended_at);
  await tick(endedAt + DAY);
  const retained = (await list()).find(row => row.id === pageRow.id);
  assert.equal(retained.destination, shared, "ending one incident preserves the same address's other subscription");
  assert.equal(await scope(following.id), null, "the completed incident no longer retains its own address");
  assert.equal((await api(`/api/app/subscribers/${pageRow.id}`, { method: "DELETE" })).status, 204);
  await fixture.erased(shared, "operator erasure removes the address after its last subscription");
}
