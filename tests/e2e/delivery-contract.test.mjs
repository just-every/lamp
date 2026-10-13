import {authFixture} from '../auth-adoption/runtime.mjs';
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer } from "vite";
import { getPlatformProxy } from "wrangler";

import { contract } from "../contract.mjs";
import { exerciseRevokedManagement } from "./subscriber-revocation-regression.mjs";
import { exerciseSubscriberTransitions } from "./subscriber-transition-helper.mjs";
import { exerciseSubscriberIsolation } from "./subscriber-isolation-helper.mjs";

let vite;
let createSubscribersService;
let registerSubscriberRoutes;
let createSubscriberRepository;
let createDeliveryRepository;
let createDeliveriesService;
let notificationPublicationStatements;
let registerDeliveryRoutes;
let platform;
let statePath;

before(async () => {
  vite = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true } });
  ({ createSubscribersService } = await vite.ssrLoadModule("/src/core/features/subscribers/service.ts"));
  ({ registerSubscriberRoutes } = await vite.ssrLoadModule("/src/core/features/subscribers/routes.ts"));
  ({ createSubscriberRepository } = await vite.ssrLoadModule("/src/core/features/subscribers/repository.ts"));
  ({ createDeliveryRepository, createDeliveriesService, notificationPublicationStatements } = await vite.ssrLoadModule("/src/core/features/deliveries/index.ts"));
  ({ registerDeliveryRoutes } = await vite.ssrLoadModule("/src/core/features/deliveries/routes.ts"));
  statePath = await mkdtemp(join(tmpdir(), "lamp-delivery-d1-"));
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", statePath, "--config", "wrangler.jsonc"], { stdio: "pipe" });
  // `wrangler d1 migrations apply --persist-to` stores Miniflare state under
  // `v3`; getPlatformProxy hands its path straight to Miniflare. Point it at
  // that same versioned directory so this exercises the migrated D1 database,
  // never the repository's shared `.wrangler` state.
  platform = await getPlatformProxy({ configPath: "wrangler.jsonc", persist: { path: join(statePath, "v3") }, remoteBindings: false });
});

after(async () => { await platform?.dispose(); await vite?.close(); await rm(statePath, { recursive: true, force: true }); });

class CapturingMail {
  configured = true;
  messages = [];
  async send(message) { this.messages.push(message); return { providerMessageId: `mail-${this.messages.length}` }; }
}

// Resend documents a default team limit of ten accepted email requests per
// second: https://resend.com/docs/api-reference/rate-limit (accessed 2026-09-08).
// This deliberately rejects above that model. A 100ms acknowledgement makes
// the test exercise the full five-minute target with both the rate cap and
// bounded provider latency. It remains a local model, not evidence of this
// deployment's account-specific quota or a provider mailbox acceptance.
class DefaultResendRateModelMail extends CapturingMail {
  recentAcceptedAt = [];
  peakPerSecond = 0;

  async send(message) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const now = Date.now();
    this.recentAcceptedAt = this.recentAcceptedAt.filter((acceptedAt) => now - acceptedAt < 1_000);
    if (this.recentAcceptedAt.length >= 10) {
      throw new Error("test-only Resend default rate model rejected more than 10 requests per second");
    }
    this.recentAcceptedAt.push(now);
    this.peakPerSecond = Math.max(this.peakPerSecond, this.recentAcceptedAt.length);
    return super.send(message);
  }
}

function signedResendHeaders(secret, id, rawBody) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64url"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64url");
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}`, "content-type": "application/json" };
}

contract("BASE-ACCESS-001", "Base email links admit only existing active operators", async()=>{
 const fixture=authFixture(platform.env.DB);
 await platform.env.DB.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES ('auth-contract','owner@example.test','Owner','owner','active',?)").bind(Date.now()).run();
 const cookie=await fixture.signIn();
 assert.equal((await fixture.handle(fixture.request('/auth/session',{cookie}))).status,200);
 const count=fixture.messages.length;await fixture.auth.requestMagicLink(fixture.request('/auth/magic-link',{method:'POST'}),{email:'unknown@example.test'});assert.equal(fixture.messages.length,count);
});
contract("BASE-ACCESS-002", "Base confirmation is preview-only on GET and single-use on POST", async()=>{
 const fixture=authFixture(platform.env.DB);await fixture.auth.requestMagicLink(fixture.request('/auth/magic-link',{method:'POST'}),{email:'owner@example.test'});
 const token=new URL(fixture.messages[0].text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
 const preview=await fixture.handle(fixture.request('/auth/confirm?token='+token));assert.equal(preview.status,200);assert.equal(preview.headers.has('set-cookie'),false);
 const confirmed=await fixture.handle(fixture.request('/auth/confirm',{method:'POST',body:{token}}));assert.equal(confirmed.status,303);assert.equal(Boolean(confirmed.headers.get('set-cookie')),true);
 assert.equal((await fixture.handle(fixture.request('/auth/confirm',{method:'POST',body:{token}}))).status,400);
});

contract("SUB-001", "concurrent subscriptions reserve one confirmation email per address each day", async () => {
  const mail = new CapturingMail();
  const service = createSubscribersService(createSubscriberRepository(platform.env.DB), { mail, fromAddress: "lamp@example.test", tokenSecret: "test-subscriber-secret" });
  await Promise.all([service.requestEmailSubscription("concurrent-reader@example.test", "https://status.example.test"), service.requestEmailSubscription("concurrent-reader@example.test", "https://status.example.test")]);
  assert.equal(mail.messages.length, 1);
  assert.match(mail.messages[0].text, /confirm-subscription/);
});

contract("SUB-005", "a confirmed subscriber's scoped public tokens revoke on one-click unsubscribe", async () => {
  const mail = new CapturingMail();
  const service = createSubscribersService(createSubscriberRepository(platform.env.DB), { mail, fromAddress: "lamp@example.test", tokenSecret: "test-subscriber-secret" });
  await service.requestEmailSubscription("scoped-reader@example.test", "https://status.example.test");
  const confirmationToken = new URL(mail.messages[0].text.match(/https:\/\/[^\s]+/)?.[0]).pathname.split("/").at(-1);
  assert.equal(await service.confirm(confirmationToken), true);
  const unsubscribeToken = new URL(mail.messages[0].text.match(/https:\/\/[^\s]+\/unsubscribe\/[^\s]+/)?.[0]).pathname.split("/").at(-1);
  assert.equal(await service.unsubscribe(unsubscribeToken), true);
  assert.equal(await service.getManagedSubscription(unsubscribeToken), null);
});

contract("SUB-001", "the actual D1 gate gives concurrent subscriptions one pending row and one email", async () => {
  const mail = new CapturingMail();
  const service = createSubscribersService(createSubscriberRepository(platform.env.DB), { mail, fromAddress: "lamp@example.test", tokenSecret: "d1-subscriber-secret" });
  await Promise.all([service.requestEmailSubscription("d1-reader@example.test", "https://status.example.test"), service.requestEmailSubscription("d1-reader@example.test", "https://status.example.test")]);
  const subscriber = await platform.env.DB.prepare("SELECT state FROM subscribers WHERE destination = ?").bind("d1-reader@example.test").first();
  const sends = await platform.env.DB.prepare("SELECT COUNT(*) AS count FROM subscriber_confirmation_attempts WHERE email_hash = ?").bind(createHash("sha256").update("confirmation-address:d1-reader@example.test").digest("base64url")).first();
  assert.equal(subscriber.state, "pending");
  assert.equal(sends.count, 1);
  assert.equal(mail.messages.length, 1);
});

contract("UPDATE-008", "actual D1 recipient capture is idempotent and an unsubscribe after commit suppresses dispatch", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T00:00:00.000Z";
  const ids = { operator: "01J00000000000000000000001", group: "01J00000000000000000000002", component: "01J00000000000000000000003", incident: "01J00000000000000000000004", update: "01J00000000000000000000005", all: "01J00000000000000000000006", selected: "01J00000000000000000000007" };
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO operators (id,email,display_name,is_setup_operator,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(ids.operator, "operator@example.test", "Operator", 1, now, now),
    db.prepare("INSERT OR IGNORE INTO component_groups (id,name,display_order,created_at,updated_at) VALUES (?,?,?,?,?)").bind(ids.group, "Core", 1, now, now),
    db.prepare("INSERT OR IGNORE INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(ids.component, ids.group, "API", "", 0, 1, "", now, now),
    db.prepare("INSERT OR IGNORE INTO incidents (id,reference,title,lifecycle,opened_at,created_by_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(ids.incident, "INC-999", "Test incident", "Investigating", now, ids.operator, now, now),
    db.prepare("INSERT OR IGNORE INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(ids.update, ids.incident, "Investigating", "API readers", "Requests fail", "", "", "2026-09-08T01:00:00.000Z", now, ids.operator, now, now),
    db.prepare("INSERT OR IGNORE INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(ids.all, "email", "all@example.test", null, "active", "all", "all-token", now, now),
    db.prepare("INSERT OR IGNORE INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(ids.selected, "email", "selected@example.test", null, "active", "selected", "selected-token", now, now),
    db.prepare("INSERT OR IGNORE INTO subscriber_components (id,subscriber_id,component_id,created_at,updated_at) VALUES (?,?,?,?,?)").bind("01J00000000000000000000008", ids.selected, ids.component, now, now),
  ]);
  const capture = () => notificationPublicationStatements(db, { eventId: ids.update, eventType: "incident-update", incidentUpdateId: ids.update, componentIds: [ids.component], channels: ["email"], queuedAt: now });
  await db.batch(capture());
  await db.batch(capture());
  const captured = await db.prepare("SELECT id, subscriber_id AS subscriberId FROM notification_deliveries WHERE notification_event_id = ?").bind(ids.update).all();
  assert.equal(captured.results.length, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE aggregate_id = ?").bind(ids.update).first()).count, 1);
  const delivery = captured.results.find((row) => row.subscriberId === ids.selected);
  await db.prepare("UPDATE subscribers SET state = 'deactivated' WHERE id = ?").bind(ids.selected).run();
  const mail = new CapturingMail();
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail, fromAddress: "lamp@example.test", subscriberTokenSecret: "delivery-secret" });
  await deliveries.dispatchDelivery(delivery.id, "https://status.example.test");
  assert.equal(mail.messages.length, 0);
  assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind(delivery.id).first()).outcome, "suppressed");
});

contract("SUB-002", "the actual D1 subscriber remains pending until its signed confirmation token is consumed", async () => {
  const mail = new CapturingMail();
  const observed = [];
  const service = createSubscribersService(createSubscriberRepository(platform.env.DB), {
    mail,
    fromAddress: "lamp@example.test",
    tokenSecret: "d1-confirmation-secret",
    events: {
      async subscriberConfirmed(event) {
        assert.equal((await platform.env.DB.prepare("SELECT state FROM subscribers WHERE id = ?").bind(event.subscriberId).first()).state, "active", "the extension sees the committed subscriber state");
        observed.push(event);
      },
      async subscriberDeactivated() {},
    },
  });
  await service.requestEmailSubscription("confirm-reader@example.test", "https://status.example.test");
  assert.equal((await platform.env.DB.prepare("SELECT state FROM subscribers WHERE destination = ?").bind("confirm-reader@example.test").first()).state, "pending");
  const token = new URL(mail.messages[0].text.match(/https:\/\/[^\s]+/)?.[0]).pathname.split("/").at(-1);
  assert.equal(await service.confirm(token), true);
  assert.equal((await platform.env.DB.prepare("SELECT state FROM subscribers WHERE destination = ?").bind("confirm-reader@example.test").first()).state, "active");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].channel, "email");
});

contract("SUB-003", "actual D1 expiry deletes an unconfirmed address and its subscriber row after 72 hours", async () => {
  const db = platform.env.DB;
  const old = "2026-09-01T00:00:00.000Z";
  await db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind("01J00000000000000000000031", "email", "expired-reader@example.test", null, "pending", "all", "expired-token", old, old).run();
  const service = createSubscribersService(createSubscriberRepository(db), { mail: new CapturingMail(), fromAddress: "lamp@example.test", tokenSecret: "d1-expiry-secret" });
  await service.expirePending();
  assert.equal(await db.prepare("SELECT id FROM subscribers WHERE id = ?").bind("01J00000000000000000000031").first(), null);
});

contract("SUB-004", "actual D1 recipient selection follows visible components and matching selected components only", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T00:00:00.000Z";
  const ids = { component: "01J00000000000000000000003", internalComponent: "01J00000000000000000000037", update: "01J00000000000000000000032", internalUpdate: "01J00000000000000000000038", all: "01J00000000000000000000033", selected: "01J00000000000000000000034", other: "01J00000000000000000000035" };
  await db.batch([
    db.prepare("INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(ids.update, "01J00000000000000000000004", "Monitoring", "API readers", "Requests are slow", "", "", "2026-09-08T01:00:00.000Z", now, "01J00000000000000000000001", now, now),
    db.prepare("INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(ids.internalUpdate, "01J00000000000000000000004", "Monitoring", "Internal readers", "No public impact", "", "", "2026-09-08T01:00:00.000Z", now, "01J00000000000000000000001", now, now),
    db.prepare("INSERT INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(ids.internalComponent, "01J00000000000000000000002", "Internal worker", "", 1, 99, "", now, now),
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(ids.all, "email", "selection-all@example.test", null, "active", "all", "selection-all-token", now, now),
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(ids.selected, "email", "selection-selected@example.test", null, "active", "selected", "selection-selected-token", now, now),
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(ids.other, "email", "selection-other@example.test", null, "active", "selected", "selection-other-token", now, now),
    db.prepare("INSERT INTO subscriber_components (id,subscriber_id,component_id,created_at,updated_at) VALUES (?,?,?,?,?)").bind("01J00000000000000000000036", ids.selected, ids.component, now, now),
  ]);
  await db.batch(notificationPublicationStatements(db, { eventId: ids.update, eventType: "incident-update", incidentUpdateId: ids.update, componentIds: [ids.component], channels: ["email"], queuedAt: now }));
  const recipients = await db.prepare("SELECT subscriber_id AS id FROM notification_deliveries WHERE notification_event_id = ? AND subscriber_id IN (?, ?, ?)").bind(ids.update, ids.all, ids.selected, ids.other).all();
  assert.deepEqual(recipients.results.map((row) => row.id).sort(), [ids.all, ids.selected].sort());
  await db.batch(notificationPublicationStatements(db, { eventId: ids.internalUpdate, eventType: "incident-update", incidentUpdateId: ids.internalUpdate, componentIds: [ids.internalComponent], channels: ["email"], queuedAt: now }));
  const internalRecipients = await db.prepare("SELECT subscriber_id AS id FROM notification_deliveries WHERE notification_event_id = ?").bind(ids.internalUpdate).all();
  assert.deepEqual(internalRecipients.results, [], "an all-components subscription follows public components only, and a selected component that became internal is not delivered");
});

contract("SUB-006", "the actual one-click endpoint deactivates by token without a cookie or redirect", async () => {
  const { Hono } = await import("hono");
  const mail = new CapturingMail();
  const service = createSubscribersService(createSubscriberRepository(platform.env.DB), { mail, fromAddress: "lamp@example.test", tokenSecret: "d1-one-click-secret" });
  await service.requestEmailSubscription("one-click@example.test", "https://status.example.test");
  const confirmation = new URL(mail.messages[0].text.match(/https:\/\/[^\s]+/)?.[0]).pathname.split("/").at(-1);
  await service.confirm(confirmation);
  const unsubscribe = new URL(mail.messages[0].text.match(/https:\/\/[^\s]+\/unsubscribe\/[^\s]+/)?.[0]).pathname.split("/").at(-1);
  const app = new Hono(); registerSubscriberRoutes(app, service);
  const response = await app.request(`https://status.example.test/unsubscribe/${unsubscribe}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await platform.env.DB.prepare("SELECT state FROM subscribers WHERE destination = ?").bind("one-click@example.test").first()).state, "deactivated");
});

contract("SUB-007", "the token-addressed management page exposes a confirmed subscription without a session", async () => {
  const { Hono } = await import("hono");
  const mail = new CapturingMail();
  const service = createSubscribersService(createSubscriberRepository(platform.env.DB), { mail, fromAddress: "lamp@example.test", tokenSecret: "d1-management-secret" });
  await service.requestEmailSubscription("manage-reader@example.test", "https://status.example.test");
  const confirmation = new URL(mail.messages[0].text.match(/https:\/\/[^\s]+/)?.[0]).pathname.split("/").at(-1);
  await service.confirm(confirmation);
  await service.requestEmailSubscription("manage-reader@example.test", "https://status.example.test");
  const manage = new URL(mail.messages.at(-1).text.match(/https:\/\/[^\s]+\/manage\/[^\s]+/)?.[0]).pathname.split("/").at(-1);
  const app = new Hono(); registerSubscriberRoutes(app, service);
  const response = await app.request(`https://status.example.test/manage/${manage}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Manage subscription/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  const subscriber = await platform.env.DB.prepare("SELECT id FROM subscribers WHERE destination = ?").bind("manage-reader@example.test").first();
  let unsubscribePath;
  for (const mutation of [
    "DELETE FROM subscriber_tokens WHERE subscriber_id = ? AND scope = 'unsubscribe'",
    "UPDATE subscriber_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE subscriber_id = ? AND scope = 'unsubscribe' AND revoked_at IS NULL",
    "UPDATE subscriber_tokens SET revoked_at = '2000-01-01T00:00:00.000Z' WHERE subscriber_id = ? AND scope = 'unsubscribe' AND revoked_at IS NULL",
  ]) {
    await platform.env.DB.prepare(mutation).bind(subscriber.id).run();
    const recovered = await app.request(`https://status.example.test/manage/${manage}`);
    assert.equal(recovered.status, 200, "current management authority repairs an unavailable unsubscribe link");
    const action = (await recovered.text()).match(/action="(\/unsubscribe\/[^\"]+)"/);
    assert.ok(Boolean(action), "management retains its native unsubscribe action");
    assert.equal(action[1] === unsubscribePath, false, "replacement links do not reuse revoked or expired authority");
    unsubscribePath = action[1];
    const reused = await app.request(`https://status.example.test/manage/${manage}`);
    assert.equal((await reused.text()).includes(`action="${unsubscribePath}"`), true, "current links are reused");
  }
  const unsubscribed = await app.request(`https://status.example.test${unsubscribePath}`, { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) });
  assert.equal(unsubscribed.status, 200);
  assert.equal(await unsubscribed.text(), "");
  assert.equal(unsubscribed.headers.get("location"), null);
});

contract("SUB-005", "in-flight subscriber permissions cannot change completed opt-out or a rejoined subscription", async () => {
  const fixture = { db: platform.env.DB, createSubscriberRepository, createSubscribersService, registerSubscriberRoutes, createMail: () => new CapturingMail() };
  await exerciseRevokedManagement(fixture);
  await exerciseSubscriberTransitions(fixture);
});

contract("PAGE-013", "subscriber HTML outcomes enforce origin isolation and token privacy", async () => {
  const { createPublicWriteRateLimiter } = await vite.ssrLoadModule("/src/core/platform/security/rate-limiter.ts");
  await exerciseSubscriberIsolation({ db: platform.env.DB, createSubscriberRepository, createSubscribersService, registerSubscriberRoutes, createPublicWriteRateLimiter, createMail: () => new CapturingMail() });
});

contract("SUB-012", "a known active address gets the same neutral form response and a management-only email", async () => {
  const { Hono } = await import("hono");
  const mail = new CapturingMail();
  const service = createSubscribersService(createSubscriberRepository(platform.env.DB), { mail, fromAddress: "lamp@example.test", tokenSecret: randomBytes(32).toString("hex") });
  const app = new Hono(); registerSubscriberRoutes(app, service);
  const submit = (email) => app.request("https://status.example.test/subscribe", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }) });
  const first = await submit("known-reader@example.test");
  const confirmation = new URL(mail.messages[0].text.match(/https:\/\/[^\s]+/)?.[0]).pathname.split("/").at(-1);
  await service.confirm(confirmation);
  const repeat = await submit("known-reader@example.test");
  assert.equal(first.status, repeat.status);
  assert.equal(await first.text(), await repeat.text());
  assert.match(mail.messages.at(-1).text, /Manage this subscription/);
  assert.doesNotMatch(mail.messages.at(-1).text, /confirm-subscription/);
});

contract("SUB-008", "a delivery committed before a real D1 unsubscribe is durably recorded as suppressed", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T02:00:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000041", "email", "suppress-reader@example.test", null, "active", "all", "suppress-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000042", "01J00000000000000000000041", "01J00000000000000000000032", "email", "queued", now, now, now, "01J00000000000000000000032", "incident-update"),
    db.prepare("UPDATE subscribers SET state = 'deactivated' WHERE id = ?").bind("01J00000000000000000000041"),
  ]);
  const mail = new CapturingMail();
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail, fromAddress: "lamp@example.test", subscriberTokenSecret: randomBytes(32).toString("hex") });
  await deliveries.dispatchDelivery("01J00000000000000000000042", "https://status.example.test");
  assert.equal(mail.messages.length, 0);
  assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind("01J00000000000000000000042").first()).outcome, "suppressed");
});

contract("NOTIFY-002", "a queued D1 email notification is accepted by the configured mail adapter and persists its provider attempt", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T03:00:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000043", "email", "notify-reader@example.test", null, "active", "all", "notify-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000044", "01J00000000000000000000043", "01J00000000000000000000032", "email", "queued", now, now, now, "01J00000000000000000000032", "incident-update"),
  ]);
  const mail = new CapturingMail();
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail, fromAddress: "lamp@example.test", subscriberTokenSecret: randomBytes(32).toString("hex") });
  await deliveries.dispatchDelivery("01J00000000000000000000044", "https://status.example.test");
  assert.equal(mail.messages.length, 1);
  assert.equal((await db.prepare("SELECT provider_message_id AS id FROM notification_delivery_attempts WHERE delivery_id = ?").bind("01J00000000000000000000044").first()).id, "mail-1");
});

contract("NOTIFY-004", "the actual delivery log exposes only contract outcomes and exports filterable CSV", async () => {
  const { Hono } = await import("hono");
  const db = platform.env.DB;
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail: new CapturingMail(), fromAddress: "lamp@example.test", subscriberTokenSecret: "d1-log-secret" });
  const { registerDeliveryRoutes } = await vite.ssrLoadModule("/src/core/features/deliveries/routes.ts");
  const app = new Hono(); registerDeliveryRoutes(app, deliveries);
  const response = await app.request("https://app.example.test/api/app/deliveries.csv?channel=email&outcome=queued");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(await response.text(), /destination,channel,outcome/);
});

contract("NOTIFY-005", "repeating D1 recipient capture records one recipient and one dispatcher command per event", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T04:00:00.000Z";
  const eventId = "01J00000000000000000000045";
  await db.prepare("INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(eventId, "01J00000000000000000000004", "Resolved", "API readers", "Recovered", "", "", "2026-09-08T05:00:00.000Z", now, "01J00000000000000000000001", now, now).run();
  const capture = () => notificationPublicationStatements(db, { eventId, eventType: "incident-update", incidentUpdateId: eventId, componentIds: ["01J00000000000000000000003"], channels: ["email"], queuedAt: now });
  await db.batch(capture()); await db.batch(capture());
  const own = await db.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE notification_event_id = ? AND subscriber_id = ?").bind(eventId, "01J00000000000000000000043").first();
  const jobs = await db.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE aggregate_id = ?").bind(eventId).first();
  assert.equal(own.count, 1); assert.equal(jobs.count, 1);
});

contract("NOTIFY-007", "the selected channel is persisted with the immutable D1 recipient set", async () => {
  const row = await platform.env.DB.prepare("SELECT channel FROM notification_channel_selections WHERE incident_update_id = ?").bind("01J00000000000000000000045").first();
  assert.equal(row.channel, "email");
});

contract("NOTIFY-008", "dispatch resolves the configured From address and never uses a recipient as sender", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T04:30:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000048", "email", "configured-from-reader@example.test", null, "active", "all", "configured-from-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000049", "01J00000000000000000000048", "01J00000000000000000000045", "email", "queued", now, now, now, "01J00000000000000000000045", "incident-update"),
  ]);
  const mail = new CapturingMail();
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail, fromAddress: async () => "status@configured.example.test", subscriberTokenSecret: "d1-from-secret" });
  await deliveries.dispatchDelivery("01J00000000000000000000049", "https://status.example.test");
  assert.equal(mail.messages[0].from, "status@configured.example.test");
  assert.equal(mail.messages[0].to, "configured-from-reader@example.test");
});

contract("NOTIFY-010", "frozen notification envelopes carry one-click, list, and incident threading headers", async () => {
  const db = platform.env.DB;
  const payload = JSON.parse((await db.prepare("SELECT mail_payload_json AS payload FROM notification_deliveries WHERE id = ?").bind("01J00000000000000000000044").first()).payload);
  assert.equal(payload.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(payload.headers["List-Unsubscribe"], /mailto:.*https:/);
  assert.ok(payload.headers["List-Id"] && payload.headers["List-Archive"] && payload.headers["List-Help"]);
  assert.equal(payload.headers["Auto-Submitted"], "auto-generated");
});

contract("TEAM-002", "Base operator revocation and Lamp erasure retain opaque audit attribution", async()=>{
 const {Hono}=await import('hono');const {requireOperator,registerOperatorRoutes}=await vite.ssrLoadModule('/src/core/features/operators/routes.ts');
 const db=platform.env.DB,fixture=authFixture(db,{owner:'setup@example.test'}),actor='01J00000000000000000000046',target='01J0000000000000000000004A';
 await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES (?,?,'Setup','owner','active',?),(?,?,'Erased operator','owner','active',?)").bind(actor,'setup@example.test',Date.now(),target,'invited@example.test',Date.now()).run();
 const cookie=await fixture.signIn();const app=new Hono();app.use('*',async(c,next)=>{c.env={DB:db};await next();});app.use('/api/app/*',requireOperator(()=>fixture.auth));registerOperatorRoutes(app,()=>fixture.auth,'status.example.test');
 assert.equal((await app.fetch(fixture.request('/api/app/operators/'+target+'/revoke-access',{method:'POST',cookie}))).status,204);
 assert.equal((await db.prepare('SELECT email FROM operators WHERE id=?').bind(target).first()).email,'invited@example.test');
 assert.equal((await app.fetch(fixture.request('/api/app/operators/'+target,{method:'DELETE',cookie}))).status,204);
 const row=await db.prepare('SELECT email,display_name FROM operators WHERE id=?').bind(target).first();assert.equal(row.email,'deleted-'+target.toLowerCase()+'@operator.invalid');assert.equal(row.display_name,'Erased operator');
 const audits=(await db.prepare('SELECT * FROM audit_entries WHERE entity_id=?').bind(target).all()).results;assert.equal(audits.some(a=>a.action==='deleted'&&a.operator_id===actor),true);assert.equal(audits.every(a=>a.payload_json==='{}'&&a.reason===null),true);
});

contract("TEAM-003", "operator subscriber deletion keeps attribution while erasing the destination", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T06:00:00.000Z";
  await db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000047", "email", "delete-reader@example.test", null, "active", "all", "delete-token", now, now).run();
  const service = createSubscribersService(createSubscriberRepository(db), { mail: new CapturingMail(), fromAddress: "lamp@example.test", tokenSecret: "d1-delete-secret" });
  assert.equal(await service.deleteSubscriber("01J00000000000000000000047", "01J00000000000000000000046"), true);
  assert.match((await db.prepare("SELECT destination FROM subscribers WHERE id = ?").bind("01J00000000000000000000047").first()).destination, /^deleted:/);
  assert.equal((await db.prepare("SELECT operator_id AS operatorId FROM audit_entries WHERE entity_id = ? AND action = 'deleted'").bind("01J00000000000000000000047").first()).operatorId, "01J00000000000000000000046");
});

contract("BASE-ACCESS-003", "D1 fixed windows reject the next public write without limiting an unrelated token path", async () => {
  const { createPublicWriteRateLimiter } = await vite.ssrLoadModule("/src/core/platform/security/rate-limiter.ts");
  const limiter = createPublicWriteRateLimiter(platform.env.DB);
  const now = new Date("2026-09-08T10:00:00.000Z");
  const attempts = await Promise.all([...Array(6)].map(() => limiter.allow({ scope: "subscribe", subject: "198.51.100.17", limit: 5, now })));
  assert.equal(attempts.filter(Boolean).length, 5);
  assert.equal(await limiter.allow({ scope: "subscription-manage", subject: "opaque-other-token", limit: 30, now }), true);
  assert.equal(await limiter.allow({ scope: "subscribe", subject: "198.51.100.17", limit: 5, now: new Date("2026-09-08T10:01:00.000Z") }), true);
});

contract("SUB-009", "an actual D1 webhook subscription signs its complete event, rejects SSRF, and treats redirects as failures", async () => {
  const db = platform.env.DB;
  const subscribers = createSubscribersService(createSubscriberRepository(db), { tokenSecret: "webhook-subscription-secret" });
  await assert.rejects(subscribers.createWebhookSubscription({ destination: "https://127.0.0.1/private", contactEmail: "webhook-contact@example.test", componentIds: [] }), /public HTTPS/);
  const subscriber = await subscribers.createWebhookSubscription({ destination: "https://receiver.example.test/lamp", contactEmail: "webhook-contact@example.test", componentIds: [] });
  const now = "2026-09-08T07:00:00.000Z";
  await db.prepare("INSERT OR IGNORE INTO incident_components (id,incident_id,component_id,component_name,state,relationship,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind("01J00000000000000000000090", "01J00000000000000000000004", "01J00000000000000000000003", "API", "Major outage", "Primary", now, now).run();
  await db.batch(notificationPublicationStatements(db, { eventId: "01J00000000000000000000045", eventType: "incident-update", incidentUpdateId: "01J00000000000000000000045", componentIds: ["01J00000000000000000000003"], channels: ["webhook"], queuedAt: now }));
  const row = await db.prepare("SELECT id FROM notification_deliveries WHERE subscriber_id = ? AND notification_event_id = ? AND channel = 'webhook'").bind(subscriber.id, "01J00000000000000000000045").first();
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response(null, { status: 204 }); };
  try {
    const deliveries = createDeliveriesService(createDeliveryRepository(db), { webhookSigningSecret: ["current-secret", "retiring-secret"] });
    await deliveries.dispatchDelivery(row.id, "https://status.example.test");
    assert.equal(sent.length, 1);
    assert.match(sent[0].init.headers["webhook-signature"], /^v1=.* v1=/);
    const body = JSON.parse(sent[0].init.body);
    assert.equal(body.event, "incident.update.published");
    assert.equal(body.incident.reference, "INC-999");
    assert.ok(Array.isArray(body.updates) && Array.isArray(body.components));
    assert.equal(JSON.stringify(body).includes("webhook-contact@example.test"), false);
    await db.prepare("UPDATE notification_deliveries SET outcome = 'queued' WHERE id = ?").bind(row.id).run();
    globalThis.fetch = async () => new Response(null, { status: 302 });
    await assert.rejects(deliveries.dispatchDelivery(row.id, "https://status.example.test"), /returned 302/);
  } finally { globalThis.fetch = realFetch; }
});

contract("SUB-010", "actual provider outcomes and repeated webhook failures deactivate the destination and notify its contact", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T07:10:00.000Z";
  await db.prepare("DELETE FROM notification_outbox").run();
  const mail = new CapturingMail();
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail, fromAddress: "lamp@example.test", subscriberTokenSecret: "bounce-token-secret", webhookSigningSecret: "webhook-failure-secret" });
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000091", "email", "hard-bounce@example.test", null, "active", "all", "hard-bounce-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000092", "01J00000000000000000000091", "01J00000000000000000000045", "email", "queued", now, now, now, "hard-bounce-event", "incident-update"),
  ]);
  await deliveries.dispatchDelivery("01J00000000000000000000092", "https://status.example.test");
  await deliveries.handleProviderEvent({ id: "provider-hard-bounce", providerMessageId: "mail-1", type: "bounced", hardBounce: true });
  const bounced = await db.prepare("SELECT state,deactivation_reason AS reason FROM subscribers WHERE id = ?").bind("01J00000000000000000000091").first();
  assert.deepEqual(bounced, { state: "deactivated", reason: "hard bounce" });

  await db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000093", "webhook", "https://failing.example.test/lamp", "failing-contact@example.test", "active", "all", "failing-webhook-token", now, now).run();
  for (let index = 0; index < 9; index += 1) {
    const suffix = String(index).padStart(2, "0");
    await db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,outcome_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(`01J000000000000000000000A${suffix}`, "01J00000000000000000000093", "01J00000000000000000000045", "webhook", "failed", `2026-09-08T07:${String(index).padStart(2, "0")}:00.000Z`, now, now, now, `prior-webhook-${index}`, "maintenance-notice").run();
  }
  await db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind("01J000000000000000000000A10", "01J00000000000000000000093", "01J00000000000000000000045", "webhook", "queued", "2026-09-08T08:00:00.000Z", now, now, "final-webhook", "maintenance-notice").run();
  await db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind("01J000000000000000000000A11", "01J00000000000000000000093", "01J00000000000000000000045", "webhook", "queued", "2026-09-08T09:00:00.000Z", now, now, "queued-webhook-backlog", "maintenance-notice").run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) await assert.rejects(deliveries.dispatchDelivery("01J000000000000000000000A10", "https://status.example.test"));
  } finally { globalThis.fetch = realFetch; }
  const failedWebhook = await db.prepare("SELECT state,deactivation_reason AS reason FROM subscribers WHERE id = ?").bind("01J00000000000000000000093").first();
  assert.deepEqual(failedWebhook, { state: "deactivated", reason: "ten consecutive webhook delivery failures" });
  await deliveries.dispatchDue("https://status.example.test");
  assert.ok(mail.messages.some((message) => message.to === "failing-contact@example.test"));
});

contract("SUB-010", "a signed Resend Permanent bounce is a hard bounce and malformed signed JSON is rejected", async () => {
  const { Hono } = await import("hono");
  const db = platform.env.DB;
  const now = "2026-09-08T08:15:00.000Z";
  const subscriberId = "resend-route-subscriber";
  const deliveryId = "resend-route-delivery";
  const providerMessageId = "resend-route-permanent";
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(subscriberId, "email", "resend-permanent@example.test", null, "active", "all", "resend-route-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(deliveryId, subscriberId, "01J00000000000000000000045", "email", "queued", now, now, now, "resend-route-event", "incident-update"),
    db.prepare("INSERT INTO notification_delivery_attempts (id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at) VALUES (?,?,?,?,?,?,?)").bind("resend-route-attempt", deliveryId, 1, now, providerMessageId, null, now),
  ]);
  const secret = `whsec_${Buffer.from("resend-route-webhook-key").toString("base64url")}`;
  const service = createDeliveriesService(createDeliveryRepository(db), { fromAddress: "lamp@example.test" });
  const app = new Hono();
  registerDeliveryRoutes(app, service, { resendWebhookSecret: secret });
  const payload = JSON.stringify({ type: "email.bounced", data: { email_id: providerMessageId, bounce: { type: "Permanent" } } });
  const response = await app.request("https://app.example.test/api/intake/mail-events", { method: "POST", headers: signedResendHeaders(secret, "msg_resend_permanent", payload), body: payload });
  assert.equal(response.status, 200);
  assert.deepEqual(await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind(deliveryId).first(), { outcome: "bounced" });
  assert.deepEqual(await db.prepare("SELECT state,deactivation_reason AS reason FROM subscribers WHERE id = ?").bind(subscriberId).first(), { state: "deactivated", reason: "hard bounce" });
  const malformed = "{";
  const malformedResponse = await app.request("https://app.example.test/api/intake/mail-events", { method: "POST", headers: signedResendHeaders(secret, "msg_resend_malformed", malformed), body: malformed });
  assert.equal(malformedResponse.status, 400);
  assert.equal(await malformedResponse.text(), "Malformed mail provider event.");
});

contract("SUB-011", "operator subscriber data includes channel, selection, deactivation reason, and deletion anonymises its destination", async () => {
  const db = platform.env.DB;
  const service = createSubscribersService(createSubscriberRepository(db), { tokenSecret: "subscriber-view-secret" });
  const entries = await service.list(100);
  const bounced = entries.find((entry) => entry.id === "01J00000000000000000000091");
  assert.equal(bounced.channel, "email");
  assert.equal(bounced.state, "deactivated");
  assert.equal(bounced.deactivationReason, "hard bounce");
  assert.equal(bounced.selectionMode, "all");
  assert.ok(bounced.deactivatedAt);
  assert.equal(await service.deleteSubscriber("01J00000000000000000000093", "01J00000000000000000000046"), true);
  assert.match((await db.prepare("SELECT destination FROM subscribers WHERE id = ?").bind("01J00000000000000000000093").first()).destination, /^deleted:/);
});

contract("SUB-010", "five consecutive soft bounces and one provider complaint each suppress later delivery", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T08:15:00.000Z";
  const softMail = new CapturingMail();
  softMail.send = async (message) => { softMail.messages.push(message); return { providerMessageId: `soft-mail-${softMail.messages.length}` }; };
  const softDeliveries = createDeliveriesService(createDeliveryRepository(db), { mail: softMail, fromAddress: "lamp@example.test", subscriberTokenSecret: "soft-bounce-token-secret" });
  await db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J000000000000000000000D01", "email", "soft-bounce@example.test", null, "active", "all", "soft-bounce-token", now, now).run();
  await db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind("01J000000000000000000000D09", "01J000000000000000000000D01", "01J00000000000000000000045", "email", "queued", "2026-09-08T09:00:00.000Z", now, now, "queued-email-backlog", "incident-update").run();
  for (let index = 0; index < 5; index += 1) {
    const deliveryId = `01J000000000000000000000D1${index}`;
    await db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(deliveryId, "01J000000000000000000000D01", "01J00000000000000000000045", "email", "queued", now, now, now, `soft-bounce-${index}`, "incident-update").run();
    await softDeliveries.dispatchDelivery(deliveryId, "https://status.example.test");
    await softDeliveries.handleProviderEvent({ id: `soft-provider-${index}`, providerMessageId: `soft-mail-${index + 1}`, type: "bounced", hardBounce: false });
  }
  assert.deepEqual(await db.prepare("SELECT state,deactivation_reason AS reason FROM subscribers WHERE id = ?").bind("01J000000000000000000000D01").first(), { state: "deactivated", reason: "five consecutive soft bounces" });

  const complaintMail = new CapturingMail();
  complaintMail.send = async (message) => { complaintMail.messages.push(message); return { providerMessageId: `complaint-mail-${complaintMail.messages.length}` }; };
  const complaintDeliveries = createDeliveriesService(createDeliveryRepository(db), { mail: complaintMail, fromAddress: "lamp@example.test", subscriberTokenSecret: "complaint-token-secret" });
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J000000000000000000000D02", "email", "complaint@example.test", null, "active", "all", "complaint-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J000000000000000000000D03", "01J000000000000000000000D02", "01J00000000000000000000045", "email", "queued", now, now, now, "complaint-event", "incident-update"),
  ]);
  await complaintDeliveries.dispatchDelivery("01J000000000000000000000D03", "https://status.example.test");
  await complaintDeliveries.handleProviderEvent({ id: "provider-complaint", providerMessageId: "complaint-mail-1", type: "complained" });
  assert.deepEqual(await db.prepare("SELECT state,deactivation_reason AS reason FROM subscribers WHERE id = ?").bind("01J000000000000000000000D02").first(), { state: "deactivated", reason: "spam complaint" });
  await complaintDeliveries.dispatchDelivery("01J000000000000000000000D03", "https://status.example.test");
  assert.equal(complaintMail.messages.length, 1);
});

contract("SUB-010", "a provider callback that beats the provider attempt is durably applied, and later delivered callbacks cannot erase a bounce", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T08:20:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("provider-race-subscriber", "email", "callback-race@example.test", null, "active", "all", "callback-race-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("provider-race-delivery", "provider-race-subscriber", "01J00000000000000000000045", "email", "queued", now, now, now, "callback-race-event", "incident-update"),
  ]);
  let deliveries;
  const mail = {
    configured: true,
    async send(message) {
      await deliveries.handleProviderEvent({ id: "callback-before-attempt", providerMessageId: "callback-race-message", type: "bounced", hardBounce: true });
      return { providerMessageId: "callback-race-message" };
    },
  };
  deliveries = createDeliveriesService(createDeliveryRepository(db), { mail, fromAddress: "lamp@example.test", subscriberTokenSecret: "callback-race-secret" });
  await deliveries.dispatchDelivery("provider-race-delivery", "https://status.example.test");
  assert.deepEqual(await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind("provider-race-delivery").first(), { outcome: "bounced" });
  assert.deepEqual(await db.prepare("SELECT state,deactivation_reason AS reason FROM subscribers WHERE id = ?").bind("provider-race-subscriber").first(), { state: "deactivated", reason: "hard bounce" });
  assert.ok((await db.prepare("SELECT applied_at AS appliedAt FROM mail_provider_webhook_events WHERE provider_event_id = ?").bind("callback-before-attempt").first()).appliedAt);
  await deliveries.handleProviderEvent({ id: "late-delivered-callback", providerMessageId: "callback-race-message", type: "delivered" });
  assert.deepEqual(await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind("provider-race-delivery").first(), { outcome: "bounced" });
  assert.deepEqual(await db.prepare("SELECT state,deactivation_reason AS reason FROM subscribers WHERE id = ?").bind("provider-race-subscriber").first(), { state: "deactivated", reason: "hard bounce" });
});

contract("SUB-010", "a replayed fifth soft bounce finishes deactivation after an interrupted outcome commit", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T08:23:00.000Z";
  const subscriberId = "soft-bounce-replay-subscriber";
  await db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(subscriberId, "email", "soft-bounce-replay@example.test", null, "active", "all", "soft-bounce-replay-token", now, now).run();
  const statements = Array.from({ length: 5 }, (_, index) => db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,outcome_at,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(`soft-bounce-replay-delivery-${index}`, subscriberId, "01J00000000000000000000045", "email", "bounced", now, now, now, now, `soft-bounce-replay-event-${index}`, "incident-update"));
  statements.push(db.prepare("INSERT INTO notification_delivery_attempts (id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind("soft-bounce-replay-attempt", "soft-bounce-replay-delivery-4", 1, now, "soft-bounce-replay-message", null, now));
  await db.batch(statements);
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { fromAddress: "lamp@example.test" });
  await deliveries.handleProviderEvent({ id: "soft-bounce-replay-event", providerMessageId: "soft-bounce-replay-message", type: "bounced", hardBounce: false });
  assert.deepEqual(await db.prepare("SELECT state,deactivation_reason AS reason FROM subscribers WHERE id = ?").bind(subscriberId).first(), { state: "deactivated", reason: "five consecutive soft bounces" });
});

contract("TEAM-003", "operator deletion removes frozen recipients and pending contact-alert recipients from D1 and CSV", async () => {
  const { Hono } = await import("hono");
  const db = platform.env.DB;
  const now = "2026-09-08T08:25:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J000000000000000000000D20", "email", "erased-reader@example.test", null, "active", "all", "erased-reader-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J000000000000000000000D21", "01J000000000000000000000D20", "01J00000000000000000000045", "email", "queued", now, now, now, "erase-envelope-event", "incident-update"),
    db.prepare("INSERT INTO notification_outbox (id,kind,aggregate_id,payload_json,available_at,attempts,locked_at,completed_at,failed_at,last_error,created_at,updated_at) VALUES (?,?,?,?,?,0,NULL,NULL,NULL,NULL,?,?)").bind("01J000000000000000000000D22", "operator-alert", "webhook-deactivated/01J000000000000000000000D20", JSON.stringify({ from: "lamp@example.test", recipients: ["erased-reader@example.test"], title: "Webhook disabled", text: "A contact address needs attention." }), now, now, now),
  ]);
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail: new CapturingMail(), fromAddress: "lamp@example.test", subscriberTokenSecret: "erasure-envelope-secret" });
  await deliveries.dispatchDelivery("01J000000000000000000000D21", "https://status.example.test");
  assert.match((await db.prepare("SELECT mail_payload_json AS payload FROM notification_deliveries WHERE id = ?").bind("01J000000000000000000000D21").first()).payload, /erased-reader@example\.test/);
  const subscribers = createSubscribersService(createSubscriberRepository(db), { tokenSecret: "erasure-subscriber-secret" });
  assert.equal(await subscribers.deleteSubscriber("01J000000000000000000000D20", "01J00000000000000000000046"), true);
  const envelope = (await db.prepare("SELECT mail_payload_json AS payload FROM notification_deliveries WHERE id = ?").bind("01J000000000000000000000D21").first()).payload;
  const alert = (await db.prepare("SELECT payload_json AS payload FROM notification_outbox WHERE id = ?").bind("01J000000000000000000000D22").first()).payload;
  assert.doesNotMatch(envelope, /erased-reader@example\.test/);
  assert.doesNotMatch(alert, /erased-reader@example\.test/);
  assert.match(alert, /"recipients":\[\]/);
  const { registerDeliveryRoutes } = await vite.ssrLoadModule("/src/core/features/deliveries/routes.ts");
  const app = new Hono(); registerDeliveryRoutes(app, deliveries);
  const csv = await (await app.request("https://app.example.test/api/app/deliveries.csv?incidentUpdateId=01J00000000000000000000045")).text();
  assert.doesNotMatch(csv, /erased-reader@example\.test/);
  assert.match(csv, /deleted:01J000000000000000000000D20/);
  await db.prepare("UPDATE notification_outbox SET completed_at = ? WHERE id <> ? AND completed_at IS NULL").bind(now, "01J000000000000000000000D22").run();
  const afterDeletionMail = new CapturingMail();
  const afterDeletion = createDeliveriesService(createDeliveryRepository(db), { mail: afterDeletionMail, fromAddress: "lamp@example.test", subscriberTokenSecret: "erasure-envelope-secret" });
  await afterDeletion.dispatchDue("https://status.example.test");
  assert.equal(afterDeletionMail.messages.length, 0, "a deleted contact is removed rather than sent a synthetic address");
});

contract("NOTIFY-001", "the concrete notification.events.v1 default captures only explicit incident update channel selections", async () => {
  const { defaultNotificationEventsPolicy } = await vite.ssrLoadModule("/src/core/features/deliveries/policies.ts");
  assert.equal(defaultNotificationEventsPolicy.id, "notification.events.v1");
  assert.deepEqual(defaultNotificationEventsPolicy.channelsForIncidentUpdate(), ["email", "webhook"]);
  assert.deepEqual(notificationPublicationStatements(platform.env.DB, { eventId: "no-recipient-event", eventType: "incident-update", incidentUpdateId: "01J00000000000000000000045", componentIds: ["01J00000000000000000000003"], channels: [], queuedAt: "2026-09-08T08:30:00.000Z" }), []);
});

contract("NOTIFY-003", "a retryable D1 delivery gets five retries then a durable failed outcome and alert job", async () => {
  const db = platform.env.DB;
  await db.prepare("DELETE FROM notification_outbox").run();
  const now = "2026-09-08T08:40:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000094", "email", "retry-failure@example.test", null, "active", "all", "retry-failure-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000095", "01J00000000000000000000094", "01J00000000000000000000045", "email", "queued", now, now, now, "retry-failure-event", "incident-update"),
  ]);
  const messages = [];
  const failedEvents = [];
  const mail = { configured: true, async send(message) {
    if (message.to === "retry-failure@example.test") { const error = new Error("temporary mail outage"); error.retryable = true; throw error; }
    messages.push(message); return { providerMessageId: `alert-${messages.length}` };
  } };
  const deliveries = createDeliveriesService(createDeliveryRepository(db), {
    mail,
    fromAddress: "lamp@example.test",
    subscriberTokenSecret: "retry-token-secret",
    events: {
      async subscriberDeactivated() {},
      async notificationFailed(event) {
        assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind(event.deliveryId).first()).outcome, "failed", "the extension sees the durable failed outcome");
        failedEvents.push(event);
      },
    },
  });
  for (let attempt = 0; attempt < 6; attempt += 1) await assert.rejects(deliveries.dispatchDelivery("01J00000000000000000000095", "https://status.example.test"));
  assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind("01J00000000000000000000095").first()).outcome, "failed");
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notification_delivery_attempts WHERE delivery_id = ?").bind("01J00000000000000000000095").first()).count, 6);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE kind = 'operator-alert' AND aggregate_id = ?").bind("delivery-failed/01J00000000000000000000095").first()).count, 1);
  assert.deepEqual(failedEvents.map((event) => ({ deliveryId: event.deliveryId, notificationEventId: event.notificationEventId })), [{ deliveryId: "01J00000000000000000000095", notificationEventId: "retry-failure-event" }]);
  await deliveries.dispatchDue("https://status.example.test");
  assert.ok(messages.length >= 1);
});

contract("NOTIFY-006", "operator alerts are frozen, uniquely queued per event, and sent once to the active operator snapshot", async () => {
  const db = platform.env.DB;
  await db.prepare("DELETE FROM notification_outbox").run();
  const mail = new CapturingMail();
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail, fromAddress: "lamp@example.test" });
  await Promise.all([
    deliveries.queueOperatorAlert({ eventId: "incident-overdue/01J00000000000000000000004", title: "Incident overdue", text: "The incident needs an update." }),
    deliveries.queueOperatorAlert({ eventId: "incident-overdue/01J00000000000000000000004", title: "Incident overdue", text: "The incident needs an update." }),
  ]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE kind = 'operator-alert'").first()).count, 1);
  const operators = await db.prepare("SELECT COUNT(*) AS count FROM operators WHERE deactivated_at IS NULL").first();
  await deliveries.dispatchDue("https://status.example.test");
  assert.equal(mail.messages.length, operators.count);
  assert.equal((await db.prepare("SELECT completed_at AS completedAt FROM notification_outbox WHERE kind = 'operator-alert'").first()).completedAt !== null, true);
});

contract("NOTIFY-009", "recipient capture commits without awaiting an unavailable provider", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T09:00:00.000Z";
  const eventId = "01J00000000000000000000096";
  await db.prepare("INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(eventId, "01J00000000000000000000004", "Monitoring", "Readers", "Delayed", "", "", "2026-09-08T10:00:00.000Z", now, "01J00000000000000000000001", now, now).run();
  await db.batch(notificationPublicationStatements(db, { eventId, eventType: "incident-update", incidentUpdateId: eventId, componentIds: ["01J00000000000000000000003"], channels: ["email"], queuedAt: now }));
  assert.ok((await db.prepare("SELECT id FROM notification_deliveries WHERE notification_event_id = ?").bind(eventId).first()));
  assert.ok((await db.prepare("SELECT id FROM notification_outbox WHERE aggregate_id = ?").bind(eventId).first()));
});

contract("TEAM-001", "every active operator reaches the same subscriber management route", async()=>{
 const {Hono}=await import('hono');const {requireOperator}=await vite.ssrLoadModule('/src/core/features/operators/routes.ts');const db=platform.env.DB,fixture=authFixture(db);
 await db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES ('equal-operator','equal@example.test','Equal','owner','active',?)").bind(Date.now()).run();
 const cookie=await fixture.signIn('equal@example.test');const app=new Hono();app.use('*',async(c,next)=>{c.env={DB:db};await next();});app.use('/api/app/*',requireOperator(()=>fixture.auth));registerSubscriberRoutes(app,createSubscribersService(createSubscriberRepository(db),{tokenSecret:'equal-operator-subscriber-token'}));
 assert.equal((await app.fetch(fixture.request('/api/app/subscribers?limit=5',{cookie}))).status,200);
});

contract("NOTIFY-003", "one failing recipient cannot strand a healthy recipient, and a concurrent webhook dispatch posts once", async () => {
  const db = platform.env.DB;
  const now = "2026-09-08T09:10:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000097", "webhook", "https://healthy.example.test/lamp", "healthy@example.test", "active", "all", "healthy-token", now, now),
    db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000098", "webhook", "https://failing-recipient.example.test/lamp", "failure@example.test", "active", "all", "failure-token", now, now),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J00000000000000000000099", "01J00000000000000000000097", "01J00000000000000000000045", "webhook", "queued", now, now, now, "mixed-retry-event", "incident-update"),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J000000000000000000000B00", "01J00000000000000000000098", "01J00000000000000000000045", "webhook", "queued", now, now, now, "mixed-retry-event", "incident-update"),
    db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("01J000000000000000000000B01", "01J00000000000000000000097", "01J00000000000000000000045", "webhook", "queued", now, now, now, "concurrent-webhook-event", "incident-update"),
  ]);
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(null, { status: String(url).includes("failing-recipient") ? 503 : 204 });
  };
  try {
    const deliveries = createDeliveriesService(createDeliveryRepository(db), { webhookSigningSecret: "mixed-retry-secret" });
    await assert.rejects(deliveries.dispatchEvent("mixed-retry-event", "https://status.example.test"));
    assert.equal((await db.prepare("SELECT outcome FROM notification_deliveries WHERE id = ?").bind("01J00000000000000000000099").first()).outcome, "delivered");
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notification_delivery_attempts WHERE delivery_id = ?").bind("01J000000000000000000000B00").first()).count, 1);
    await Promise.all([deliveries.dispatchDelivery("01J000000000000000000000B01", "https://status.example.test"), deliveries.dispatchDelivery("01J000000000000000000000B01", "https://status.example.test")]);
    assert.equal(requests.filter((url) => url.includes("healthy.example.test")).length, 2); // one mixed delivery + one concurrent delivery
  } finally { globalThis.fetch = realFetch; }
});

contract("NOTIFY-004", "SQL filters delivery and outbox rows before applying their limits, so failed history cannot starve due work", async () => {
  const db = platform.env.DB;
  await db.prepare("DELETE FROM notification_outbox").run();
  const now = "2026-09-08T09:20:00.000Z";
  const statements = [];
  for (let index = 0; index < 12; index += 1) statements.push(db.prepare("INSERT INTO notification_outbox (id,kind,aggregate_id,payload_json,available_at,attempts,locked_at,completed_at,failed_at,last_error,created_at,updated_at) VALUES (?, 'delivery-dispatch', ?, '{}', ?, 6, NULL, NULL, ?, 'failed', ?, ?)")
    .bind(`01J000000000000000000000C${String(index).padStart(2, "0")}`, `failed-${index}`, now, now, now, now));
  statements.push(db.prepare("INSERT INTO notification_outbox (id,kind,aggregate_id,payload_json,available_at,attempts,locked_at,completed_at,failed_at,last_error,created_at,updated_at) VALUES (?, 'delivery-dispatch', ?, '{\"eventId\":\"due-after-failures\"}', ?, 0, NULL, NULL, NULL, NULL, ?, ?)")
    .bind("01J000000000000000000000C99", "due-after-failures", now, now, now));
  await db.batch(statements);
  const repository = createDeliveryRepository(db);
  assert.deepEqual((await repository.listOutbox(1, now)).map((job) => job.aggregateId), ["due-after-failures"]);
  const deliveries = createDeliveriesService(repository);
  const delivered = await deliveries.list({ outcome: "delivered", limit: 1 });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].outcome, "delivered");
});

contract("SUB-011", "operator pagination makes every subscriber reachable beyond the first hundred records", async () => {
  const { Hono } = await import("hono");
  const db = platform.env.DB;
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM subscribers").first();
  const statements = [];
  for (let index = 0; index < 101; index += 1) {
    const timestamp = `2099-01-01T00:00:00.${String(index).padStart(3, "0")}Z`;
    statements.push(db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(`pagination-subscriber-${index}`, "email", `pagination-subscriber-${String(index).padStart(3, "0")}@example.test`, null, "active", "all", `pagination-token-${index}`, timestamp, timestamp));
  }
  await db.batch(statements);
  const app = new Hono();
  registerSubscriberRoutes(app, createSubscribersService(createSubscriberRepository(db), { tokenSecret: "pagination-subscriber-secret" }));
  const first = await app.request(`https://app.example.test/api/app/subscribers?limit=100&offset=${existing.count}`);
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.subscribers.length, 100);
  assert.equal(firstBody.offset, existing.count);
  assert.equal(firstBody.hasMore, true);
  const second = await app.request(`https://app.example.test/api/app/subscribers?limit=100&offset=${existing.count + 100}`);
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.subscribers.length, 1);
  assert.equal(secondBody.subscribers[0].destination, "pagination-subscriber-100@example.test");
  assert.equal(secondBody.hasMore, false);
});

contract("NOTIFY-004", "operator pagination and CSV keep delivery history reachable beyond the first hundred records", async () => {
  const { Hono } = await import("hono");
  const db = platform.env.DB;
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM notification_deliveries").first();
  const statements = [];
  for (let index = 0; index < 101; index += 1) {
    const timestamp = `2099-01-01T00:01:00.${String(index).padStart(3, "0")}Z`;
    const subscriberId = `pagination-delivery-subscriber-${index}`;
    statements.push(
      db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(subscriberId, "email", `pagination-delivery-${String(index).padStart(3, "0")}@example.test`, null, "active", "all", `pagination-delivery-token-${index}`, timestamp, timestamp),
      db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(`pagination-delivery-${index}`, subscriberId, "01J00000000000000000000045", "email", "queued", timestamp, timestamp, timestamp, `pagination-event-${index}`, "incident-update"),
    );
  }
  await db.batch(statements);
  const app = new Hono();
  registerDeliveryRoutes(app, createDeliveriesService(createDeliveryRepository(db)));
  const first = await app.request(`https://app.example.test/api/app/deliveries?limit=100&offset=${existing.count}`);
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.deliveries.length, 100);
  assert.equal(firstBody.offset, existing.count);
  assert.equal(firstBody.hasMore, true);
  const second = await app.request(`https://app.example.test/api/app/deliveries?limit=100&offset=${existing.count + 100}`);
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.deliveries.length, 1);
  assert.equal(secondBody.deliveries[0].destination, "pagination-delivery-100@example.test");
  assert.equal(secondBody.hasMore, false);
  const csv = await (await app.request("https://app.example.test/api/app/deliveries.csv?channel=email&outcome=queued")).text();
  assert.equal((csv.match(/pagination-delivery-\d{3}@example\.test/g) ?? []).length, 101);
});

contract("NOTIFY-002", "the local D1 engine dispatches a 1,000-recipient set within the documented default Resend rate model", async () => {
  const db = platform.env.DB;
  const subscriberLimit = 1_000;
  const now = "2099-01-02T00:00:00.000Z";
  const componentId = "fanout-limit-component";
  const eventId = "fanout-limit-event";
  // This final test owns its active population, so the captured set is exactly
  // the declared limit rather than incidental subscribers from earlier cases.
  await db.prepare("UPDATE subscribers SET state = 'deactivated' WHERE state = 'active'").run();
  await db.prepare("INSERT INTO components (id,group_id,name,description,internal,display_order,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(componentId, "01J00000000000000000000002", "Fan-out workload component", "", 0, 9_999, "", now, now).run();
  for (let offset = 0; offset < subscriberLimit; offset += 100) {
    const statements = [];
    for (let index = offset; index < Math.min(offset + 100, subscriberLimit); index += 1) {
      statements.push(db.prepare("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(`fanout-limit-${index}`, "email", `fanout-limit-${String(index).padStart(4, "0")}@example.test`, null, "active", "all", `fanout-limit-token-${index}`, now, now));
    }
    await db.batch(statements);
  }
  const startedAt = performance.now();
  await db.batch(notificationPublicationStatements(db, {
    eventId,
    eventType: "incident-update",
    incidentUpdateId: "01J00000000000000000000045",
    componentIds: [componentId],
    channels: ["email"],
    queuedAt: now,
  }));
  const captured = await db.prepare("SELECT COUNT(*) AS count FROM notification_deliveries WHERE notification_event_id = ?").bind(eventId).first();
  assert.equal(captured.count, subscriberLimit);
  const mail = new DefaultResendRateModelMail();
  const deliveries = createDeliveriesService(createDeliveryRepository(db), { mail, fromAddress: "lamp@example.test", subscriberTokenSecret: "fanout-limit-secret" });
  await deliveries.dispatchEvent(eventId, "https://status.example.test");
  const elapsedMs = performance.now() - startedAt;
  const accepted = await db.prepare("SELECT COUNT(*) AS count FROM notification_delivery_attempts attempt JOIN notification_deliveries delivery ON delivery.id = attempt.delivery_id WHERE delivery.notification_event_id = ? AND attempt.provider_message_id IS NOT NULL").bind(eventId).first();
  assert.equal(mail.messages.length, subscriberLimit);
  assert.equal(accepted.count, subscriberLimit);
  assert.ok(mail.peakPerSecond <= 10, `dispatcher exceeded the 10 request/second Resend default model: ${mail.peakPerSecond}`);
  assert.ok(elapsedMs < 5 * 60_000, `local fan-out took ${Math.round(elapsedMs)}ms, beyond the five-minute contract window`);
  console.log(`LOCAL_FANOUT subscribers=${subscriberLimit} transport_ack_ms=100 resend_default_rate_model_rps=10 peak_rps=${mail.peakPerSecond} elapsed_ms=${Math.round(elapsedMs)} provider=test-only-rate-model`);
});
