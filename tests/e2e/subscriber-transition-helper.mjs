import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { holdAuthorizationRead, mailedPath, state } from "./subscriber-revocation-regression.mjs";

const origin = "https://status.example.test";
const post = body => ({ method: "POST", headers: { Accept: "text/html" }, body: new URLSearchParams(body) });
const oneClick = () => post({ "List-Unsubscribe": "One-Click" });

export async function exerciseSubscriberTransitions({ db, createSubscriberRepository, createSubscribersService, registerSubscriberRoutes, createMail }) {
  const componentIds = [0, 1].map(() => `01${randomBytes(12).toString("hex").toUpperCase()}`);
  const now = new Date().toISOString(), allObserved = [];
  await db.batch(componentIds.map(id => db.prepare("INSERT INTO components (id,name,description,internal,display_order,note,created_at,updated_at) VALUES (?, 'Transition component', '', 0, 1, '', ?, ?)").bind(id, now, now)));

  async function fixture(active) {
    const mail = createMail(), observed = [];
    const options = {
      mail, fromAddress: "lamp@example.test", tokenSecret: randomUUID(),
      events: {
        async subscriberConfirmed(event) {
          const row = await db.prepare("SELECT state FROM subscribers WHERE id = ?").bind(event.subscriberId).first();
          const usable = await db.prepare("SELECT COUNT(*) AS count FROM subscriber_tokens WHERE subscriber_id = ? AND scope = 'confirm' AND revoked_at IS NULL").bind(event.subscriberId).first();
          observed.push("confirmed");
          allObserved.push({ type: "confirmed", stateCommitted: row.state === "active", permissionsConsumed: usable.count === 0 });
        },
        async subscriberDeactivated(event) {
          const row = await db.prepare("SELECT state FROM subscribers WHERE id = ?").bind(event.subscriberId).first();
          const usable = await db.prepare("SELECT COUNT(*) AS count FROM subscriber_tokens WHERE subscriber_id = ? AND revoked_at IS NULL").bind(event.subscriberId).first();
          observed.push("deactivated");
          allObserved.push({ type: "deactivated", stateCommitted: row.state === "deactivated", permissionsConsumed: usable.count === 0 });
        },
      },
    };
    const appFor = binding => {
      const app = new Hono();
      registerSubscriberRoutes(app, createSubscribersService(createSubscriberRepository(binding), options));
      return app;
    };
    const app = appFor(db), email = `${randomUUID()}@example.test`;
    const request = (path, init) => app.request(origin + path, init);
    assert.equal((await request("/subscribe", post({ email }))).status, 202);
    const confirm = mailedPath(mail, "confirm-subscription"), unsubscribe = mailedPath(mail, "unsubscribe");
    const subscriber = await db.prepare("SELECT id FROM subscribers WHERE destination = ?").bind(email).first();
    async function management() {
      assert.equal((await request("/subscribe", post({ email }))).status, 202);
      return mailedPath(mail, "manage");
    }
    let manage;
    if (active) {
      assert.equal((await request(confirm)).status, 200);
      manage = await management();
      assert.equal((await request(manage, post({ componentId: componentIds[0] }))).status, 200);
    }
    return { appFor, request, email, mail, subscriber, observed, confirm, unsubscribe, manage, management };
  }

  for (const action of ["selection", "unsubscribe", "confirm"]) {
    for (const renewedState of ["none", "pending", "active"]) {
      const f = await fixture(action !== "confirm");
      const gate = holdAuthorizationRead(db);
      const path = action === "selection" ? f.manage : f[action];
      const init = action === "selection" ? post({}) : action === "unsubscribe" ? oneClick() : undefined;
      const inFlight = f.appFor(gate.binding).request(origin + path, init);
      try {
        await gate.wait();
        const optedOut = await f.request(f.unsubscribe, oneClick());
        assert.equal(optedOut.status, 200);
        assert.equal(await optedOut.text(), "", "one-click success remains empty with HTML Accept");
        assert.equal(optedOut.headers.get("set-cookie"), null);
        assert.equal(optedOut.headers.get("location"), null);
        let currentConfirm, currentManage, currentUnsubscribe;
        if (renewedState !== "none") {
          const emailHash = createHash("sha256").update(`confirmation-address:${f.email}`).digest("base64url");
          await db.prepare("UPDATE subscriber_confirmation_attempts SET last_sent_at = ? WHERE email_hash = ?").bind("2000-01-01T00:00:00.000Z", emailHash).run();
          assert.equal((await f.request("/subscribe", post({ email: f.email }))).status, 202);
          currentConfirm = mailedPath(f.mail, "confirm-subscription");
          currentUnsubscribe = mailedPath(f.mail, "unsubscribe");
          if (renewedState === "active") {
            assert.equal((await f.request(currentConfirm)).status, 200);
            currentManage = await f.management();
            assert.equal((await f.request(currentManage, post({ componentId: componentIds[1] }))).status, 200);
          }
        }
        const before = await state(db, f.subscriber.id), eventsBefore = f.observed.length;
        gate.release();
        assert.equal((await inFlight).status, 404, `${action} refuses earlier authority after ${renewedState} rejoin`);
        assert.equal(await state(db, f.subscriber.id) === before, true, "refusal preserves exact subscription, selection and permission records");
        assert.equal(f.observed.length, eventsBefore, "refusal emits no lifecycle event");
        if (renewedState !== "none") {
          if (renewedState === "pending") {
            assert.equal((await f.request(currentConfirm)).status, 200, "current rejoin confirmation survives refusal");
            currentManage = await f.management();
          }
          assert.equal((await f.request(currentManage, post({}))).status, 200, "current management can still clear selection");
          const row = await db.prepare("SELECT selection_mode FROM subscribers WHERE id = ?").bind(f.subscriber.id).first();
          assert.equal(row.selection_mode, "all");
          assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM subscriber_components WHERE subscriber_id = ?").bind(f.subscriber.id).first()).count, 0);
          assert.equal((await f.request(currentUnsubscribe, post({ action: "unsubscribe" }))).status, 200, "current HTML unsubscribe survives refusal");
        }
      } finally { gate.release(); await inFlight; }
    }
  }

  // Both requests have read the same current confirmation. Only the request
  // that commits first may consume it and emit the complete lifecycle fact.
  const f = await fixture(false), gate = holdAuthorizationRead(db);
  const inFlight = f.appFor(gate.binding).request(origin + f.confirm);
  try {
    await gate.wait();
    assert.equal((await f.request(f.confirm)).status, 200);
    const before = await state(db, f.subscriber.id);
    gate.release();
    assert.equal((await inFlight).status, 404);
    assert.equal(await state(db, f.subscriber.id) === before, true);
    assert.deepEqual(f.observed, ["confirmed"], "overlapping confirmation emits exactly once");
  } finally { gate.release(); await inFlight; }
  assert.equal(allObserved.every(event => event.stateCommitted && event.permissionsConsumed), true, "each lifecycle event follows the complete committed transition");
}
