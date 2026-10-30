import assert from "node:assert/strict";
import { openSubscriberManagementFixture } from "./subscriber-management-fixture.mjs";

const HOUR = 3_600_000;

/** Native subscription and scheduled doors share one controlled Worker clock. */
export async function subscriberExpiryFlow() {
  const fixture = await openSubscriberManagementFixture({ workerEntry: "tests/e2e/helpers/automation-clock-worker.ts" });
  const { raw, db, list, publicOrigin } = fixture;
  const start = Date.now() + 60_000;
  const address = number => [`synthetic-lamp-expiry-${number}`, "example.test"].join("@");
  const clock = async now => {
    const response = await raw("/test/clock", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ now }) });
    assert.equal(response.status, 204, await response.text());
  };
  const tick = async now => {
    await clock(now);
    const result = await (await fixture.runtime.getWorker()).scheduled({ cron: "* * * * *", scheduledTime: now });
    assert.equal(result.outcome, "ok", "the native scheduled handler completes at the controlled instant");
  };
  const subscribe = async number => {
    const email = address(number);
    const response = await raw(`${publicOrigin}/subscribe`, { method: "POST", headers: {
      Origin: publicOrigin, "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": `192.0.2.${number}`,
    }, body: new URLSearchParams({ email }).toString() });
    assert.equal(response.status, 202, await response.text());
    const subscriber = (await list()).find(row => row.destination === email);
    assert.ok(subscriber, "the operator inventory contains the publicly submitted address");
    assert.equal(subscriber.state, "pending");
    const mail = fixture.messagesFor(email).find(message => message.text.includes("/confirm-subscription/"));
    assert.ok(mail, "the real mail transport captured this subscription's confirmation");
    return { ...subscriber, confirmation: mail.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0] };
  };
  const inventory = async expected => assert.deepEqual((await list()).map(row => row.id).sort(), expected.map(row => row.id).sort(), "operator inventory exactly reconciles pending expiry and the confirmed control");
  const persisted = id => db.prepare("SELECT * FROM subscribers WHERE id = ?").bind(id).first();
  const erased = async subscriber => {
    assert.equal(await persisted(subscriber.id), null, "expiry deletes the persisted subscription itself");
    for (const [table, rows] of await fixture.databaseState()) assert.ok(!rows.includes(subscriber.destination), `${table} retains no expired address`);
    assert.equal((await raw(subscriber.confirmation)).status, 404, "replaying the old confirmation cannot restore the expired address");
    assert.equal(await persisted(subscriber.id), null, "the replay leaves the subscription absent");
  };
  try {
    await clock(start);
    const first = await subscribe(1);
    const confirmed = await subscribe(2);
    await fixture.confirm(confirmed.destination);
    const active = await persisted(confirmed.id);
    assert.equal(active.state, "active");
    await clock(start + 2 * HOUR);
    const second = await subscribe(3);
    assert.equal(Date.parse(first.createdAt), start);
    assert.equal(Date.parse(second.createdAt), start + 2 * HOUR, "each subscription has its own creation instant");

    for (const [expiring, survivors] of [[first, [confirmed, second]], [second, [confirmed]]]) {
      const deadline = Date.parse(expiring.createdAt) + 72 * HOUR;
      await tick(deadline - 1);
      // The ordinary operator session expires during the three-day advance.
      await fixture.signIn(undefined, { fresh: true });
      await inventory([expiring, ...survivors]);
      const before = await persisted(expiring.id);
      assert.equal(before.state, "pending", "one millisecond before its deadline the subscription remains pending");
      assert.equal(before.destination, expiring.destination, "its address remains while confirmation is possible");
      await tick(deadline);
      await inventory(survivors);
      await erased(expiring);
      assert.deepEqual(await persisted(confirmed.id), active, "scheduled expiry preserves every field of the confirmed subscription");
      await tick(deadline);
      await inventory(survivors);
      await erased(expiring);
    }
  } finally { await fixture.close(); }
}
