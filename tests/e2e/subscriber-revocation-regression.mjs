import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Hono } from "hono";

// Hold a real D1 response, not a repository result manufactured by the test.
// Every query and write still executes against the migrated workerd database.
export function holdAuthorizationRead(db) {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  let armed = true;
  const statement = native => new Proxy(native, {
    get(target, property) {
      if (property === "bind") return (...args) => statement(target.bind(...args));
      if (["raw", "all", "first"].includes(property)) return async (...args) => {
        const result = await target[property](...args);
        const hasRows = Array.isArray(result) ? result.length > 0 : Array.isArray(result?.results) ? result.results.length > 0 : result !== null;
        if (armed && hasRows) {
          armed = false;
          entered.resolve();
          await released.promise;
        }
        return result;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    binding: new Proxy(db, {
      get(target, property) {
        if (property === "prepare") return sql => armed ? statement(target.prepare(sql)) : target.prepare(sql);
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    async wait() {
      let timeout;
      try {
        await Promise.race([entered.promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Management authorization read was not reached")), 10_000); })]);
      } finally { clearTimeout(timeout); }
    },
    release: () => released.resolve(),
  };
}

export function mailedPath(mail, kind) {
  const link = mail.messages.at(-1).text.match(new RegExp(`https://[^\\s]+/${kind}/[^\\s]+`));
  assert.ok(Boolean(link), "mail carries the required subscription action");
  return new URL(link[0]).pathname;
}

export async function state(db, subscriberId) {
  const [subscriber, tokens, selection] = await db.batch([
    db.prepare("SELECT * FROM subscribers WHERE id = ?").bind(subscriberId),
    db.prepare("SELECT * FROM subscriber_tokens WHERE subscriber_id = ? ORDER BY id").bind(subscriberId),
    db.prepare("SELECT * FROM subscriber_components WHERE subscriber_id = ? ORDER BY id").bind(subscriberId),
  ]);
  return JSON.stringify([subscriber.results, tokens.results, selection.results]);
}

export async function exerciseRevokedManagement({ db, createSubscriberRepository, createSubscribersService, registerSubscriberRoutes, createMail }) {
  const origin = "https://status.example.test";
  const post = body => ({ method: "POST", headers: { Accept: "text/html" }, body: new URLSearchParams(body) });
  for (const renewedState of ["none", "pending", "active"]) {
    for (const availableLink of [true, false]) {
      const mail = createMail();
      const options = { mail, fromAddress: "lamp@example.test", tokenSecret: "synthetic-fixture-revocation-secret" };
      const appFor = binding => {
        const app = new Hono();
        registerSubscriberRoutes(app, createSubscribersService(createSubscriberRepository(binding), options));
        return app;
      };
      const app = appFor(db);
      const request = (path, init) => app.request(origin + path, init);
      const email = `revocation-${renewedState}-${availableLink}@example.test`;
      assert.equal((await request("/subscribe", post({ email }))).status, 202);
      const unsubscribe = mailedPath(mail, "unsubscribe");
      assert.equal((await request(mailedPath(mail, "confirm-subscription"))).status, 200);
      assert.equal((await request("/subscribe", post({ email }))).status, 202);
      const manage = mailedPath(mail, "manage");
      const subscriber = await db.prepare("SELECT id FROM subscribers WHERE destination = ?").bind(email).first();
      const gate = holdAuthorizationRead(db);
      const inFlight = appFor(gate.binding).request(origin + manage);
      try {
        await gate.wait();
        assert.equal((await request(unsubscribe, post({ "List-Unsubscribe": "One-Click" }))).status, 200);
        const optedOut = await db.prepare("SELECT state FROM subscribers WHERE id = ?").bind(subscriber.id).first();
        assert.equal(optedOut.state, "deactivated", "opt-out is committed before resuming management");
        assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM subscriber_tokens WHERE subscriber_id = ? AND revoked_at IS NULL").bind(subscriber.id).first()).count, 0);
        if (renewedState !== "none") {
          // Move this fixture's anti-bomb reservation into the past so rejoin
          // traverses the normal confirmation-email path without a day-long wait.
          const emailHash = createHash("sha256").update(`confirmation-address:${email}`).digest("base64url");
          await db.prepare("UPDATE subscriber_confirmation_attempts SET last_sent_at = ? WHERE email_hash = ?").bind("2000-01-01T00:00:00.000Z", emailHash).run();
          assert.equal((await request("/subscribe", post({ email }))).status, 202);
          if (renewedState === "active") assert.equal((await request(mailedPath(mail, "confirm-subscription"))).status, 200);
          assert.equal((await db.prepare("SELECT state FROM subscribers WHERE id = ?").bind(subscriber.id).first()).state, renewedState);
          if (!availableLink) await db.prepare("DELETE FROM subscriber_tokens WHERE subscriber_id = ? AND scope = 'unsubscribe'").bind(subscriber.id).run();
        }
        const before = await state(db, subscriber.id);
        gate.release();
        const response = await inFlight;
        const html = await response.text();
        const action = html.match(/action="(\/unsubscribe\/[^\"]+)"/);
        if (action) assert.equal((await request(action[1], post({ "List-Unsubscribe": "One-Click" }))).status, 404, "an earlier request cannot act on renewed authority");
        assert.equal(response.status, 404, "withdrawn management authority is refused");
        assert.equal(await state(db, subscriber.id) === before, true, "the earlier request preserves committed state, selection and token records");
      } finally {
        gate.release();
        await inFlight;
      }
    }
  }
}
