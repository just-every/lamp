import { subscriberLimitsFlow } from "./subscriber-limits-flow.mjs";
import assert from "node:assert/strict";
import { openSubscriberManagementFixture, subscriberCsv, subscriberCsvRows, pageOrigin } from "./subscriber-management-fixture.mjs";

const previewPath = "/api/app/subscribers/import/preview";
const applyPath = "/api/app/subscribers/import/apply";

/** SUB-017 extends the existing MOVE-002 silent-import/explicit-invitation
 * journey. This independent installation exercises the actual CSV HTTP doors. */
export async function subscriberCsvFlow() {
  const fixture = await openSubscriberManagementFixture();
  const { api, post, list, messagesFor } = fixture;
  try {
    const owner = (await api("/api/app/session")).body.operator;
    const component = await fixture.createComponent("Synthetic Lamp CSV API");
    const internal = await fixture.createComponent("Synthetic Lamp CSV internal", true);
    const headers = ["email", "phone", "webhook_url", "contact_email", "components", "language"];
    const emails = Array.from({ length: 96 }, (_, index) => `${index === 0 ? "+" : ""}synthetic-lamp-import-${index + 1}@example.test`);
    const webhook = "https://receiver.example.test/synthetic-lamp-1";
    const contact = "synthetic-lamp-import-webhook-contact@example.test";
    const csv = subscriberCsv(headers, [
      ...emails.map(email => [email, "", "", "", component.id, "en"]),
      ["", "", webhook, contact, component.id, "en"],
      ...['synthetic-lamp-invalid,"quoted"', "synthetic-lamp-invalid@", "synthetic lamp\r\ninvalid@example.test"].map(email => [email, "", "", "", component.id, "en"]),
    ]);
    assert.equal((await fixture.raw(previewPath, { method: "POST", body: JSON.stringify({ csv }) })).status, 401);
    assert.equal((await fixture.raw("/api/app/subscribers.csv")).status, 401);
    assert.equal((await fixture.raw("/api/app/subscribers/import/batches")).status, 401);
    assert.equal((await fixture.raw(pageOrigin + "/api/app/subscribers/import/batches")).status, 404);
    assert.equal((await fixture.raw(pageOrigin + "/api/app/subscribers.csv")).status, 404);
    const before = await fixture.databaseState(), mailBefore = fixture.messages.length;
    const preview = await post(previewPath, { csv });
    assert.equal(preview.status, 200, preview.text);
    assert.deepEqual(preview.body.counts, { created: 97, skipped: 0, refused: 3 });
    assert.equal(preview.body.rows.length, 100);
    const refused = preview.body.rows.filter(row => row.outcome === "refused");
    assert.equal(refused.length, 3);
    assert.ok(refused.every(row => Number.isInteger(row.row) && typeof row.reason === "string" && row.reason.trim()));
    assert.equal(new Set(refused.map(row => row.row)).size, 3);
    await fixture.assertUnchanged(before);
    assert.equal(fixture.messages.length, mailBefore, "a CSV dry run sends no mail");

    const stale = await post(applyPath, { csv: csv.replace(emails[1], "synthetic-lamp-changed@example.test"), reviewedFingerprint: preview.body.fingerprint });
    assert.equal(stale.status, 409, stale.text);
    await fixture.assertUnchanged(before);
    const applied = await post(applyPath, { csv, reviewedFingerprint: preview.body.fingerprint });
    assert.equal(applied.status, 200, applied.text);
    assert.deepEqual(applied.body.counts, { created: 97, skipped: 0, refused: 3 });
    assert.equal(applied.body.subscriberIds.length, 97);
    const batches = async () => {
      const result = await api("/api/app/subscribers/import/batches");
      assert.equal(result.status, 200, result.text);
      assert.ok(result.body.batches.every(row => Object.keys(row).sort().join(",") === "batchId,createdAt,remaining"), "batch summaries contain no subscriber destinations or tokens");
      return result.body.batches;
    };
    assert.deepEqual((await batches()).map(row => [row.batchId, row.remaining]), [[applied.body.batchId, 97]]);
    assert.equal(new Set(applied.body.subscriberIds).size, 97);
    const pending = await list();
    assert.equal(pending.length, 97);
    assert.ok(pending.every(row => row.state === "pending"));
    assert.ok(pending.every(row => row.componentSelections.length === 1 && row.componentSelections[0].componentId === component.id));
    assert.ok(pending.every(row => row.addedBy?.id === owner.id && row.addedBy.displayName === owner.displayName));
    assert.equal(pending.find(row => row.destination === webhook)?.contactEmail, contact);
    assert.equal(fixture.messages.length, mailBefore, "applying the CSV leaves every recipient pending and sends no invitation");
    const obligations = await api("/api/app/overview/follow-ups");
    assert.equal(obligations.status, 200, obligations.text);
    const csvObligations = obligations.body.followUps.filter(row => row.kind === "imported-invitation" && applied.body.subscriberIds.some(id => row.id.endsWith(`:${id}`)));
    assert.equal(csvObligations.length, 97, "every pending CSV confirmation is a real durable follow-up");
    for (const obligation of csvObligations) {
      const subscriber = pending.find(row => obligation.id.endsWith(`:${row.id}`));
      assert.equal(obligation.link, "/app/subscribers");
      assert.equal(obligation.dueAt, new Date(Date.parse(subscriber.createdAt) + 72 * 3_600_000).toISOString());
      assert.ok(obligation.stopCondition.trim());
    }
    const replay = await post(applyPath, { csv, reviewedFingerprint: preview.body.fingerprint });
    assert.equal(replay.status, 409, replay.text);
    const againBefore = await fixture.databaseState();
    const again = await post(previewPath, { csv });
    assert.equal(again.status, 200, again.text);
    assert.deepEqual(again.body.counts, { created: 0, skipped: 97, refused: 3 });
    await fixture.assertUnchanged(againBefore);
    const importedAudit = await api("/api/app/audit-log?action=subscriber.imported&limit=100");
    assert.equal(importedAudit.status, 200, importedAudit.text);
    assert.equal(importedAudit.body.entries.length, 97);
    assert.ok(importedAudit.body.entries.every(entry => entry.actorId === owner.id && applied.body.subscriberIds.includes(entry.entityId)));

    const exportResponse = await fixture.request("/api/app/subscribers.csv");
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get("content-type"), /^text\/csv/);
    assert.equal(exportResponse.headers.get("cache-control"), "no-store");
    const exportedText = await exportResponse.text(), exported = subscriberCsvRows(exportedText);
    assert.equal(exported.length, 97);
    assert.deepEqual(Object.keys(exported[0]), ["channel", "destination", "contact_email", "state", "components", "consent_at"]);
    assert.ok(exported.every(row => row.state === "pending" && row.consent_at === "" && row.components === component.id));
    assert.ok(exported.some(row => row.destination === `'${emails[0]}`), "a formula-leading destination is neutralised inside the quoted CSV cell");
    assert.ok(exported.some(row => row.channel === "webhook" && row.destination === webhook && row.contact_email === contact));
    assert.doesNotMatch(exportedText, /token_hash|tokenHash|\/confirm-subscription\/|\/manage\//, "export contains consent facts, never subscriber credentials");

    const sendPath = `/api/app/subscribers/import/${applied.body.batchId}/send-invitations`;
    assert.equal((await fixture.raw(sendPath, { method: "POST", body: "{}" })).status, 401);
    const crossSite = await api(sendPath, { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: "{}" });
    assert.equal(crossSite.status, 403);
    await fixture.publish(component, "Synthetic Lamp CSV pending publication");
    assert.equal(fixture.messages.length, mailBefore, "pending CSV subscriptions receive no published incident before consent");
    for (const expected of [{ sent: 50, remaining: 47 }, { sent: 47, remaining: 0 }, { sent: 0, remaining: 0 }]) {
      const sent = await post(sendPath);
      assert.equal(sent.status, 200, sent.text);
      assert.deepEqual(sent.body, expected);
      assert.equal((await batches()).find(row => row.batchId === applied.body.batchId).remaining, expected.remaining, "reloading a batch summary keeps the authoritative remaining invitations");
    }
    assert.equal(fixture.messages.length, mailBefore + 97);
    for (const email of [...emails, contact]) {
      assert.equal(messagesFor(email).length, 1, "an imported recipient receives exactly one confirmation");
      assert.match(messagesFor(email)[0].text, /\/confirm-subscription\//);
    }
    for (const repeated of await Promise.all([post(sendPath), post(sendPath)])) {
      assert.equal(repeated.status, 200, repeated.text);
      assert.deepEqual(repeated.body, { sent: 0, remaining: 0 });
    }
    assert.equal(fixture.messages.length, mailBefore + 97, "repeated concurrent owner actions cannot send a second invitation");
    assert.ok((await list()).every(row => row.state === "pending"), "sending mail never confirms consent");
    await fixture.confirm(contact);
    const confirmedWebhook = (await list()).find(row => row.destination === webhook);
    assert.equal(confirmedWebhook.state, "active", "a webhook confirms through its contact address");
    assert.ok(!(await api("/api/app/overview/follow-ups")).body.followUps.some(row => row.kind === "imported-invitation" && row.id.endsWith(`:${confirmedWebhook.id}`)), "confirmation removes the native CSV obligation");

    const invalidCsv = subscriberCsv(headers, [
      ["", "+12025550123", "", "", component.id, "en"],
      ["synthetic-lamp-spanish@example.test", "", "", "", component.id, "es"],
      ["synthetic-lamp-internal@example.test", "", "", "", internal.id, "en"],
      ["", "", "https://receiver.example.test/synthetic-lamp-2", "not-an-email", component.id, "en"],
    ]);
    const invalidBefore = await fixture.databaseState(), invalidMail = fixture.messages.length;
    const invalid = await post(previewPath, { csv: invalidCsv });
    assert.equal(invalid.status, 200, invalid.text);
    assert.deepEqual(invalid.body.counts, { created: 0, skipped: 0, refused: 4 });
    assert.ok(invalid.body.rows.every(row => row.outcome === "refused" && row.reason));
    assert.equal(invalid.body.rows[0].reason, "SMS subscribers are not available (SUB-013)");
    await fixture.assertUnchanged(invalidBefore);
    assert.equal(fixture.messages.length, invalidMail);
    const rowLimit = await post(previewPath, { csv: "email\r\n" + Array.from({ length: 5001 }, (_, index) => `synthetic-lamp-limit-${index}@example.test\r\n`).join("") });
    assert.equal(rowLimit.status, 400, rowLimit.text);
    const byteLimit = await post(previewPath, { csv: "email\r\n" + "x".repeat(8 * 1024 * 1024) });
    assert.equal(byteLimit.status, 413, byteLimit.text);
    const recordLimit = await post(previewPath, { csv: "email\r\n" + "x".repeat(512 * 1024 + 1) + "\r\n" });
    assert.equal(recordLimit.status, 400, recordLimit.text);
    await fixture.assertUnchanged(invalidBefore);
    assert.equal(fixture.messages.length, invalidMail, "refused input never sends confirmation mail");
  } finally { await fixture.close(); }
  await subscriberLimitsFlow();
}
