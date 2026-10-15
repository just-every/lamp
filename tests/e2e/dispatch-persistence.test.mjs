import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { getPlatformProxy } from "wrangler";

let vite, platform, statePath, createDeliveryRepository, createDeliveriesService;
before(async () => {
  vite = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true } });
  ({ createDeliveryRepository, createDeliveriesService } = await vite.ssrLoadModule("/src/core/features/deliveries/index.ts"));
  statePath = await mkdtemp(join(tmpdir(), "lamp-dispatch-persistence-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", statePath, "--config", "wrangler.jsonc"], { stdio: "pipe" });
  platform = await getPlatformProxy({ configPath: "wrangler.jsonc", persist: { path: join(statePath, "v3") }, remoteBindings: false });
  const db = platform.env.DB;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO operators (id,email,display_name,created_at,updated_at) VALUES ('dispatch-test-operator','operator@example.test','Dispatch test',?,?)").bind(now, now),
    db.prepare("INSERT INTO maintenance (id,reference,title,state,starts_at,ends_at,created_by_operator_id,created_at,updated_at) VALUES ('dispatch-test-maintenance','SCH-1','Dispatch test','Scheduled',?,?,'dispatch-test-operator',?,?)").bind(now, now, now, now),
  ]);
});
after(async () => { await platform?.dispose(); await vite?.close(); if (statePath) await rm(statePath, { recursive: true, force: true }); });

async function seedDelivery(id) {
  const db = platform.env.DB;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,'email',?,'active','all',?,?,?)")
      .bind(id, `${id}@example.test`, `test-only-${id}`, now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,maintenance_id,channel,outcome,queued_at,created_at,updated_at) VALUES (?,?,'dispatch-test-maintenance','email','queued',?,?,?)")
      .bind(id, id, now, now, now),
  ]);
  return db;
}

function envelope(id, subject = "Original") {
  return JSON.stringify({ frozenAt: new Date().toISOString(), from: "lamp@example.test", to: `${id}@example.test`, subject, text: "Frozen content", html: "<p>Frozen content</p>", headers: { "List-Unsubscribe": "<https://status.example.test/unsubscribe/test-only>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }, idempotencyKey: `notification/${id}` });
}

test("Frozen email persistence survives contention and failed reads", async t => {
  t.diagnostic("native D1 concurrent freezes and later retries return the entire first committed envelope");
  await (async () => {
  const id = "freeze-first-winner";
  const db = await seedDelivery(id);
  const repository = createDeliveryRepository(db);
  const candidates = [envelope(id), envelope(id, "Competing")];
  const winners = await Promise.all(candidates.map(candidate => repository.freezeMailPayload(id, candidate)));
  const stored = await db.prepare("SELECT mail_payload_json AS payload FROM notification_deliveries WHERE id = ?").bind(id).first();
  assert.ok(candidates.includes(stored.payload));
  assert.deepEqual(winners, [stored.payload, stored.payload]);
  assert.equal(await repository.freezeMailPayload(id, envelope(id, "Retry")), stored.payload);
  await assert.rejects(repository.freezeMailPayload("absent-delivery", candidates[0]), /Delivery envelope could not be frozen\./);
})(t);
  t.diagnostic("native D1 rejects and rolls back a freeze when its authoritative read fails");
  await (async () => {
  const id = "freeze-read-failure";
  const db = await seedDelivery(id);
  // Fault injection changes only the read statement; the real D1 batch executes
  // the conditional write and must roll it back when the second statement fails.
  const failingBinding = {
    prepare: sql => db.prepare(sql),
    batch: statements => {
      assert.equal(statements.length, 2);
      return db.batch([statements[0], db.prepare("SELECT * FROM test_only_missing_freeze_table")]);
    },
  };
  await assert.rejects(createDeliveryRepository(failingBinding).freezeMailPayload(id, envelope(id)), /test_only_missing_freeze_table/);
  assert.equal((await db.prepare("SELECT mail_payload_json AS payload FROM notification_deliveries WHERE id = ?").bind(id).first()).payload, null);
  const candidate = envelope(id, "After recovery");
  assert.equal(await createDeliveryRepository(db).freezeMailPayload(id, candidate), candidate);
})(t);
});



test("Provider receipts reconcile before and after durable callback mapping", async t => {
  t.diagnostic("provider acceptance with an empty callback ledger skips mapping and later callbacks still apply");
  await (async () => {
  const id = "empty-callback-ledger";
  const db = await seedDelivery(id);
  const repository = createDeliveryRepository(db);
  await repository.freezeMailPayload(id, envelope(id));
  const order = [];
  for (const method of ["recordAcceptedEmailAttempt", "recordAttempt", "listPendingProviderEvents", "findDeliveryByProviderMessageId", "claimProviderEvent", "markProviderOutcome", "completeProviderEvent"]) {
    const original = repository[method].bind(repository);
    repository[method] = async (...args) => { order.push(method); return original(...args); };
  }
  const providerMessageId = `provider-${id}`;
  const service = createDeliveriesService(repository, { mail: { configured: true, async send() { return { providerMessageId }; } } });
  await service.dispatchDelivery(id, "https://status.example.test");
  assert.deepEqual(order, ["recordAcceptedEmailAttempt"]);
  assert.equal((await repository.getDelivery(id)).subscriberState, "active");
  assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind(id).first()).outcome, "queued");
  order.length = 0;
  const callback = { id: "late-callback", providerMessageId, type: "delivered" };
  await service.handleProviderEvent(callback);
  assert.deepEqual(order, ["listPendingProviderEvents", "findDeliveryByProviderMessageId", "claimProviderEvent", "markProviderOutcome", "completeProviderEvent"]);
  assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind(id).first()).outcome, "delivered");
  order.length = 0;
  await service.handleProviderEvent(callback);
  assert.deepEqual(order, ["listPendingProviderEvents"]);
})(t);
  t.diagnostic("an early callback stays unclaimed without a persisted mapping and resumes after the attempt");
  await (async () => {
  const id = "early-callback-ledger";
  const db = await seedDelivery(id);
  const repository = createDeliveryRepository(db);
  const service = createDeliveriesService(repository, {});
  const callback = { id: "early-callback", providerMessageId: `provider-${id}`, type: "bounced", hardBounce: true };
  await service.handleProviderEvent(callback);
  const pending = await db.prepare("SELECT claimed_at AS claimed, applied_at AS applied, delivery_id AS delivery FROM mail_provider_webhook_events WHERE provider_event_id = ?").bind(callback.id).first();
  assert.deepEqual(pending, { claimed: null, applied: null, delivery: null });
  const now = new Date().toISOString();
  await repository.recordAttempt({ id: `attempt-${id}`, deliveryId: id, attemptNumber: 1, attemptedAt: now, providerMessageId: callback.providerMessageId, error: null, createdAt: now });
  await service.dispatchDue("https://status.example.test");
  const applied = await db.prepare("SELECT claimed_at AS claimed, applied_at AS applied, delivery_id AS delivery FROM mail_provider_webhook_events WHERE provider_event_id = ?").bind(callback.id).first();
  assert.equal(applied.claimed, null);
  assert.ok(applied.applied);
  assert.equal(applied.delivery, id);
  assert.equal((await repository.getDelivery(id)).subscriberState, "deactivated");
  assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind(id).first()).outcome, "bounced");
})(t);
});



test("Only committed lease winners may dispatch", async t => {
  t.diagnostic("a native claim batch exposes the post-claim row only to its winner and preserves lease expiry");
  await (async () => {
  const id = "claim-batch-winner";
  const db = await seedDelivery(id);
  const repository = createDeliveryRepository(db);
  const now = "2026-10-07T00:10:00.000Z", before = "2026-10-07T00:05:00.000Z";
  const claims = await Promise.all([repository.claimAndGetDelivery(id, now, before), repository.claimAndGetDelivery(id, now, before)]);
  assert.equal(claims.filter(result => result.claimed).length, 1);
  assert.equal(claims.find(result => result.claimed).delivery.id, id);
  assert.deepEqual(claims.find(result => !result.claimed), { claimed: false, delivery: null });
  assert.equal((await db.prepare("SELECT dispatch_locked_at AS locked FROM notification_deliveries WHERE id = ?").bind(id).first()).locked, now);
  assert.deepEqual(await repository.claimAndGetDelivery(id, now, before), { claimed: false, delivery: null });
  await db.prepare("UPDATE subscribers SET state = 'deactivated' WHERE id = ?").bind(id).run();
  const recovered = await repository.claimAndGetDelivery(id, "2026-10-07T00:16:00.000Z", "2026-10-07T00:11:00.000Z");
  assert.equal(recovered.claimed, true);
  assert.equal(recovered.delivery.subscriberState, "deactivated");
  await repository.releaseDeliveryClaim(id);
  let sends = 0;
  const service = createDeliveriesService(repository, { mail: { configured: true, async send() { sends++; throw new Error("Must not send"); } } });
  await service.dispatchDelivery(id, "https://status.example.test");
  assert.equal(sends, 0);
  assert.deepEqual(await db.prepare("SELECT outcome, dispatch_locked_at AS locked FROM notification_deliveries WHERE id = ?").bind(id).first(), { outcome: "suppressed", locked: null });
})(t);
  t.diagnostic("a failed authoritative claim read rolls back the durable lease");
  await (async () => {
  const id = "claim-read-failure";
  const db = await seedDelivery(id);
  const failingBinding = { prepare: sql => db.prepare(sql), batch: statements => db.batch([statements[0], db.prepare("SELECT * FROM test_only_missing_claim_table")]) };
  await assert.rejects(createDeliveryRepository(failingBinding).claimAndGetDelivery(id, new Date().toISOString(), "2000-01-01T00:00:00Z"), /test_only_missing_claim_table/);
  assert.equal((await db.prepare("SELECT dispatch_locked_at AS locked FROM notification_deliveries WHERE id = ?").bind(id).first()).locked, null);
  const claim = await createDeliveryRepository(db).claimAndGetDelivery(id, new Date().toISOString(), "2000-01-01T00:00:00Z");
  assert.equal(claim.claimed, true);
  assert.equal(claim.delivery.id, id);
})(t);
});



test("accepted receipt batch rollback preserves provider idempotency and callback replay across restart", async t => {
  const id = "accepted-batch-rollback";
  const db = await seedDelivery(id);
  const { SendGridMailSender } = await vite.ssrLoadModule("/src/core/platform/mail/sendgrid.ts");
  const { createMailSendRepository } = await vite.ssrLoadModule("/src/core/platform/mail/repository.ts");
  const repository = createDeliveryRepository(db);
  await repository.freezeMailPayload(id, envelope(id));
  let failAcceptedRead = true;
  const binding = {
    prepare: sql => db.prepare(sql),
    batch(statements) {
      // Accepted receipt statements are bound, so target the next batch from
      // this explicitly wrapped repository method, not a SQL-string heuristic.
      if (failAcceptedRead) return db.batch([statements[0], db.prepare("SELECT * FROM test_only_missing_receipt_table")]);
      return db.batch(statements);
    },
  };
  const faulty = createDeliveryRepository(binding);
  repository.recordAcceptedEmailAttempt = input => faulty.recordAcceptedEmailAttempt(input);
  const sender = () => new SendGridMailSender({ apiKey: "test-only-key", fromAddress: "lamp@example.test" }, createMailSendRepository(db));
  let service = createDeliveriesService(repository, { mail: sender(), fromAddress: "lamp@example.test" });
  let wireCalls = 0, providerMessageId;
  t.mock.method(globalThis, "fetch", async (url, input) => {
    assert.equal(url, "https://api.sendgrid.com/v3/mail/send");
    wireCalls++;
    providerMessageId = JSON.parse(input.body).custom_args.lamp_message_id;
    await service.handleProviderEvent({ id: "sendgrid/test-only-early-receipt", providerMessageId, type: "delivered" });
    return new Response(null, { status: 202 });
  });
  await assert.rejects(service.dispatchDelivery(id, "https://status.example.test"), /test_only_missing_receipt_table/);
  assert.equal(wireCalls, 1);
  assert.equal((await createMailSendRepository(db).get(providerMessageId)).state, "accepted");
  const failedAttempts = (await db.prepare("SELECT attempt_number AS number, provider_message_id AS provider, error FROM notification_delivery_attempts WHERE delivery_id = ?").bind(id).all()).results;
  assert.equal(failedAttempts.length, 1);
  assert.equal(failedAttempts[0].number, 1);
  assert.equal(failedAttempts[0].provider, null);
  assert.match(failedAttempts[0].error, /test_only_missing_receipt_table/);
  assert.deepEqual(await db.prepare("SELECT outcome, dispatch_locked_at AS locked FROM notification_deliveries WHERE id = ?").bind(id).first(), { outcome: "queued", locked: null });
  assert.equal((await repository.listPendingProviderEvents(providerMessageId)).length, 1);
  failAcceptedRead = false;
  // New service, adapter and repositories recover from durable state only.
  service = createDeliveriesService(createDeliveryRepository(db), { mail: sender(), fromAddress: "lamp@example.test" });
  await service.dispatchDelivery(id, "https://status.example.test");
  assert.equal(wireCalls, 1, "provider acceptance cannot cause a second wire send after a local rollback");
  assert.deepEqual((await db.prepare("SELECT attempt_number AS number, provider_message_id AS provider, error FROM notification_delivery_attempts WHERE delivery_id = ? ORDER BY attempt_number").bind(id).all()).results.map(row => ({ ...row, error: row.error ? "failure" : null })), [{ number: 1, provider: null, error: "failure" }, { number: 2, provider: providerMessageId, error: null }]);
  assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind(id).first()).outcome, "delivered");
  assert.deepEqual(await repository.listPendingProviderEvents(providerMessageId), []);
  await service.dispatchDelivery(id, "https://status.example.test");
  assert.equal(wireCalls, 1);
});
