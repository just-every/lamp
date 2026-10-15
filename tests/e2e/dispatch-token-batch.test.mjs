import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { tokenFixture } from "./helpers/dispatch-token-fixture.mjs";

let fixture;
before(async () => { fixture = await tokenFixture(); });
after(async () => { await fixture?.close(); });
const origin = "https://status.example.test";
const candidates = prefix => ({ manage: { id: `${prefix}-manage`, tokenHash: `synthetic-${prefix}-manage-hash` }, unsubscribe: { id: `${prefix}-unsubscribe`, tokenHash: `synthetic-${prefix}-unsubscribe-hash` } });
const rows = async id => (await fixture.db.prepare("SELECT id, scope, token_hash AS hash, revoked_at AS revoked FROM subscriber_tokens WHERE subscriber_id = ? ORDER BY scope, id").bind(id).all()).results;

test("Atomic subscriber token allocation, isolation, rollback and revocation", async t => {
  t.diagnostic("native token batch returns the same committed scope winners to concurrent deliveries and isolates subscribers");
  await (async () => {
  const { seed, db, now, createDeliveryRepository } = fixture;
  await seed("token-winner"); await seed("token-other");
  const repository = createDeliveryRepository(db);
  const values = await Promise.all(["first", "second"].map(prefix => repository.ensureNotificationTokens("token-winner", candidates(prefix), now)));
  assert.deepEqual(values[0], values[1]);
  const stored = await rows("token-winner");
  assert.equal(stored.length, 2);
  for (const scope of ["manage", "unsubscribe"]) assert.equal(values[0][scope], stored.find(row => row.scope === scope).id);
  assert.deepEqual(await repository.ensureNotificationTokens("token-winner", candidates("retry"), now), values[0]);
  const other = await repository.ensureNotificationTokens("token-other", candidates("other"), now);
  assert.notDeepEqual(other, values[0]);
  assert.equal((await rows("token-winner")).length, 2);
  assert.equal((await rows("token-other")).length, 2);
})(t);
  t.diagnostic("native token batch rolls back both allocations when the authoritative read fails");
  await (async () => {
  const { seed, db, now, createDeliveryRepository } = fixture;
  await seed("token-read-fault");
  const failing = {
    prepare: sql => db.prepare(sql),
    batch: statements => {
      assert.equal(statements.length, 3);
      return db.batch([...statements.slice(0, 2), db.prepare("SELECT * FROM test_only_missing_token_read")]);
    },
  };
  await assert.rejects(createDeliveryRepository(failing).ensureNotificationTokens("token-read-fault", candidates("read-fault"), now), /test_only_missing_token_read/);
  assert.deepEqual(await rows("token-read-fault"), []);
  const winner = await createDeliveryRepository(db).ensureNotificationTokens("token-read-fault", candidates("read-recovered"), now);
  assert.deepEqual(winner, { manage: "read-recovered-manage", unsubscribe: "read-recovered-unsubscribe" });
})(t);
  t.diagnostic("native token batch rolls back the first scope when the second violates a real uniqueness constraint");
  await (async () => {
  const { seed, db, now, createDeliveryRepository } = fixture;
  await seed("token-constraint"); await seed("token-constraint-owner");
  const repository = createDeliveryRepository(db), input = candidates("constraint");
  await repository.ensureNotificationTokens("token-constraint-owner", candidates("constraint-owner"), now);
  input.unsubscribe.tokenHash = "synthetic-constraint-owner-unsubscribe-hash";
  await assert.rejects(repository.ensureNotificationTokens("token-constraint", input, now), /UNIQUE constraint failed/);
  assert.deepEqual(await rows("token-constraint"), []);
  assert.equal((await rows("token-constraint-owner")).length, 2);
})(t);
  t.diagnostic("native token batch retains an existing scope and never reuses a revoked token");
  await (async () => {
  const { seed, db, now, createDeliveryRepository, createSubscriberRepository } = fixture;
  await seed("token-revoked");
  const repository = createDeliveryRepository(db), subscribers = createSubscriberRepository(db);
  const original = await repository.ensureNotificationTokens("token-revoked", candidates("revoked"), now);
  await subscribers.revokeTokens("token-revoked", now, "manage");
  const changed = await repository.ensureNotificationTokens("token-revoked", candidates("replacement"), now);
  assert.notEqual(changed.manage, original.manage);
  assert.equal(changed.unsubscribe, original.unsubscribe);
  assert.equal((await rows("token-revoked")).find(row => row.id === original.manage).revoked, now);
  await subscribers.deactivateSubscriber("token-revoked", "test unsubscribe", now);
  assert.equal(await repository.ensureNotificationTokens("token-revoked", candidates("inactive"), now), null);
  assert.ok((await rows("token-revoked")).every(row => row.revoked));
  assert.equal((await rows("token-revoked")).length, 3);
  assert.equal(await repository.ensureNotificationTokens("absent-subscriber", candidates("absent"), now), null);
})(t);
});







test("Dispatch respects revoked recipients and retries only committed scoped tokens", async t => {
  t.diagnostic("deactivation and deletion during sender configuration suppress dispatch without recreating links or personal envelopes");
  await (async () => {
  const { seed, db, now, createDeliveryRepository, createDeliveriesService, createSubscriberRepository } = fixture;
  const subscribers = createSubscriberRepository(db);
  for (const action of ["deactivate", "delete"]) {
    const id = `token-before-${action}`; await seed(id);
    let sends = 0;
    const service = createDeliveriesService(createDeliveryRepository(db), {
      subscriberTokenSecret: "test-only-token-secret",
      fromAddress: async () => {
        if (action === "delete") await subscribers.anonymizeAndDeactivate(id, "token-operator", now);
        else await subscribers.deactivateSubscriber(id, "unsubscribe before links", now);
        return "lamp@example.test";
      },
      mail: { configured: true, async send() { sends++; throw Error("must not send"); } },
    });
    await service.dispatchDelivery(id, origin);
    assert.equal(sends, 0);
    assert.deepEqual(await rows(id), []);
    assert.deepEqual(await db.prepare("SELECT outcome, mail_payload_json AS envelope, dispatch_locked_at AS locked FROM notification_deliveries WHERE id = ?").bind(id).first(), { outcome: "suppressed", envelope: null, locked: null });
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notification_delivery_attempts WHERE delivery_id = ?").bind(id).first()).n, 0);
  }
})(t);
  t.diagnostic("token transaction failure records a durable error and releases the claim before a fresh service retry");
  await (async () => {
  const { seed, db, createDeliveryRepository, createDeliveriesService } = fixture;
  const id = "token-service-fault"; await seed(id);
  const repository = createDeliveryRepository(db);
  const faulty = createDeliveryRepository({ prepare: sql => db.prepare(sql), batch: statements => db.batch([...statements.slice(0, 2), db.prepare("SELECT * FROM test_only_token_service_failure")]) });
  repository.ensureNotificationTokens = faulty.ensureNotificationTokens;
  const messages = [], options = { subscriberTokenSecret: "test-only-token-secret", fromAddress: "lamp@example.test", mail: { configured: true, async send(message) { messages.push(message); return { providerMessageId: "token-retry-receipt" }; } } };
  await assert.rejects(createDeliveriesService(repository, options).dispatchDelivery(id, origin), /test_only_token_service_failure/);
  assert.equal(messages.length, 0); assert.deepEqual(await rows(id), []);
  assert.deepEqual(await db.prepare("SELECT outcome, dispatch_locked_at AS locked FROM notification_deliveries WHERE id = ?").bind(id).first(), { outcome: "queued", locked: null });
  const failed = await db.prepare("SELECT attempt_number AS number, error, provider_message_id AS provider FROM notification_delivery_attempts WHERE delivery_id = ?").bind(id).first();
  assert.equal(failed.number, 1); assert.equal(failed.provider, null); assert.match(failed.error, /test_only_token_service_failure/);
  const restarted = createDeliveriesService(createDeliveryRepository(db), options);
  await restarted.dispatchDelivery(id, origin); await restarted.dispatchDelivery(id, origin);
  assert.equal(messages.length, 1);
  assert.deepEqual((await db.prepare("SELECT attempt_number AS number, provider_message_id AS provider FROM notification_delivery_attempts WHERE delivery_id = ? ORDER BY attempt_number").bind(id).all()).results, [{ number: 1, provider: null }, { number: 2, provider: "token-retry-receipt" }]);
})(t);
  t.diagnostic("concurrent real dispatch uses committed links whose signatures and database scopes address only their subscriber");
  await (async () => {
  const { seed, db, now, createDeliveryRepository, createDeliveriesService, createSubscriberRepository, SubscriberTokenCodec } = fixture;
  const id = "token-concurrent-mail"; await seed(id); await seed(`${id}-second`, id);
  const messages = [], secret = "test-only-shared-token-secret";
  const service = createDeliveriesService(createDeliveryRepository(db), { subscriberTokenSecret: secret, fromAddress: "lamp@example.test", mail: { configured: true, async send(message) { messages.push(message); return { providerMessageId: `token-mail-${messages.length}` }; } } });
  await Promise.all([service.dispatchDelivery(id, origin), service.dispatchDelivery(`${id}-second`, origin)]);
  assert.equal(messages.length, 2); assert.equal((await rows(id)).length, 2);
  const codec = new SubscriberTokenCodec(secret), subscribers = createSubscriberRepository(db);
  for (const scope of ["manage", "unsubscribe"]) {
    const token = messages[0].text.match(new RegExp(`https://status.example.test/${scope}/([^\\s]+)`))[1];
    assert.ok(messages[1].text.includes(token));
    assert.equal(await codec.validatesShapeAndSignature(token, scope), true);
    const hash = await codec.hash(token);
    assert.equal((await subscribers.findSubscriberByToken(hash, scope, now)).subscriber.id, id);
    assert.equal(await subscribers.findSubscriberByToken(hash, scope === "manage" ? "unsubscribe" : "manage", now), null);
    await subscribers.revokeTokens(id, now, scope);
    assert.equal(await subscribers.findSubscriberByToken(hash, scope, now), null);
  }
})(t);
});





test("a retry retains the entire frozen mail after tokens, sender, destination and rendered content change", async () => {
  const { seed, db, now, createDeliveryRepository, createDeliveriesService, createSubscriberRepository } = fixture;
  const id = "token-frozen-retry"; await seed(id);
  const messages = [];
  const mail = { configured: true, async send(message) {
    messages.push(structuredClone(message));
    if (messages.length === 1) throw new Error("test-only transient provider rejection");
    return { providerMessageId: "token-frozen-receipt" };
  } };
  const original = createDeliveriesService(createDeliveryRepository(db), { mail, subscriberTokenSecret: "test-only-original-secret", fromAddress: "original@example.test" });
  await assert.rejects(original.dispatchDelivery(id, origin), /transient provider rejection/);
  const frozen = (await db.prepare("SELECT mail_payload_json AS envelope FROM notification_deliveries WHERE id = ?").bind(id).first()).envelope;
  await createSubscriberRepository(db).revokeTokens(id, now);
  await db.batch([
    db.prepare("UPDATE subscribers SET destination = 'changed@example.test' WHERE id = ?").bind(id),
    db.prepare("UPDATE incidents SET title = 'Changed title' WHERE id = 'token-incident'"),
    db.prepare("UPDATE incident_updates SET customer_impact = 'Changed impact' WHERE id = 'token-update'"),
  ]);
  const repository = createDeliveryRepository(db);
  repository.ensureNotificationTokens = async () => { throw Error("frozen retries must not allocate or resolve new links"); };
  const restarted = createDeliveriesService(repository, { mail, subscriberTokenSecret: "test-only-replacement-secret", fromAddress: "changed@example.test" });
  await restarted.dispatchDelivery(id, "https://changed.example.test");
  assert.deepEqual(messages[1], messages[0]);
  assert.equal(messages[1].idempotencyKey, `notification/${id}`);
  assert.equal((await db.prepare("SELECT mail_payload_json AS envelope FROM notification_deliveries WHERE id = ?").bind(id).first()).envelope, frozen);
  assert.ok((await rows(id)).every(row => row.revoked));
  assert.equal((await rows(id)).length, 2);
  await restarted.dispatchDelivery(id, origin);
  assert.equal(messages.length, 2);
});
