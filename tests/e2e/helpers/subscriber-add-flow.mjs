import { existsSync } from 'node:fs';
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { eventuallySubscriber } from "./subscriber-management-fixture.mjs";
import assert from "node:assert/strict";
import { subscriberQueuedUnsubscribe } from './subscriber-queued-unsubscribe.mjs';
import { openSubscriberManagementFixture, subscriberCsvRows, pageOrigin } from "./subscriber-management-fixture.mjs";

async function auditSubscriberEmails(messages) {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ["--no-sandbox", "--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext();
    // Captured provider HTML is rendered without contacting its authored links.
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    const hydrationErrors = [];
    page.on("pageerror", error => { if (/hydration|did not match|server rendered/i.test(error.message)) hydrationErrors.push(error.message); });
    for (const [kind, message] of messages) for (const width of [1440]) {
      assert.match(message.html, /^<!doctype html><html lang="en">/i, `${kind}: complete English document`);
      assert.match(message.html, /<body[ >]/); assert.match(message.html, /<\/body><\/html>$/);
      assert.ok(!/<pre[ >]/i.test(message.html), `${kind}: prose wraps without pre`);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.setContent(message.html);
      await page.getByRole("heading", { level: 1 }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${kind} ${width}: no horizontal overflow`);
      const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      assert.deepEqual(audit.violations.filter(row => ["serious", "critical"].includes(row.impact)).map(row => row.id), [], `${kind} ${width}: PAGE-020 axe audit`);
    }
    assert.deepEqual(hydrationErrors, []);
  } finally { await browser.close(); }
}

/** Operator adds exercise the same public confirmation and real publication
 * doors as self-service consent, with recipient selection observed at Resend. */
export async function subscriberAddFlow() {
  const fixture = await openSubscriberManagementFixture();
  const { api, post, list, messagesFor } = fixture;
  try {
    const owner = (await api("/api/app/session")).body.operator;
    const first = await fixture.createComponent("Synthetic Lamp first selected API");
    const second = await fixture.createComponent("Synthetic Lamp second selected API");
    const third = await fixture.createComponent("Synthetic Lamp unselected API");
    const internal = await fixture.createComponent("Synthetic Lamp hidden API", true);
    const email = "noc@customer.example";
    const added = await post("/api/app/subscribers", { channel: "email", email, componentIds: [first.id, second.id] });
    assert.equal(added.status, 201, added.text);
    assert.equal(added.body.created, true);
    assert.equal(added.body.confirmationSent, true);
    assert.equal(added.body.subscriber.state, "pending");
    assert.equal(messagesFor(email).length, 1);
    assert.match(messagesFor(email)[0].text, /\/confirm-subscription\//);
    const id = added.body.subscriber.id;
    const selected = row => row.componentSelections.map(selection => selection.componentId).sort();
    const row = (await list()).find(row => row.id === id);
    assert.deepEqual(selected(row), [first.id, second.id].sort());
    assert.deepEqual(row.addedBy, { id: owner.id, displayName: owner.displayName });
    const obligation = (await api("/api/app/overview/follow-ups")).body.followUps.find(item => item.kind === "imported-invitation" && item.id.endsWith(`:${id}`));
    assert.ok(obligation, "an operator-added pending confirmation is a durable follow-up");
    assert.equal(obligation.link, "/app/subscribers");
    assert.equal(obligation.dueAt, new Date(Date.parse(row.createdAt) + 72 * 3_600_000).toISOString());
    const duplicate = await post("/api/app/subscribers", { channel: "email", email, componentIds: [third.id] });
    assert.equal(duplicate.status, 200, duplicate.text);
    assert.equal(duplicate.body.created, false);
    assert.equal(duplicate.body.confirmationSent, false);
    assert.equal(duplicate.body.subscriber.id, id);
    assert.equal(messagesFor(email).length, 1, "repeating Add cannot send another confirmation");
    assert.deepEqual(selected((await list()).find(row => row.id === id)), [first.id, second.id].sort(), "an existing destination retains its choices");
    await fixture.publish(first, "Synthetic Lamp pending consent publication");
    assert.equal(messagesFor(email).length, 1, "a pending operator-added subscriber receives no incident update");
    const confirmedAfter = Date.now();
    await fixture.confirm(email);
    const confirmedBefore = Date.now();
    assert.equal((await list()).find(row => row.id === id).state, "active");
    assert.ok(!(await api("/api/app/overview/follow-ups")).body.followUps.some(item => item.id === obligation.id), "confirmation removes the operator-add obligation");
    const firstPublication = await fixture.publish(first, "Synthetic Lamp selected first publication");
    const secondPublication = await fixture.publish(second, "Synthetic Lamp selected second publication");
    const thirdPublication = await fixture.publish(third, "Synthetic Lamp unselected third publication");
    const delivered = messagesFor(email).filter(message => !message.text.includes("/confirm-subscription/"));
    assert.equal(delivered.length, 2, "both selected components notify and the third sends nothing");
    assert.ok(delivered.some(message => message.text.includes(firstPublication.incident.reference)));
    assert.ok(delivered.some(message => message.text.includes(secondPublication.incident.reference)));
    assert.ok(delivered.every(message => !message.text.includes(thirdPublication.incident.reference)));
    const notice = await post("/api/app/maintenance", { title: "synthetic-lamp-020", affectedAudience: "Customers using the selected API.", customerImpact: "Requests may be interrupted during maintenance. " + "Wrapping maintenance wording. ".repeat(6), startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString(), componentIds: [first.id], autoStart: false });
    assert.equal(notice.status, 201, notice.text);
    const scheduled = await (await fixture.runtime.getWorker()).scheduled({ cron: "* * * * *" });
    assert.equal(scheduled.outcome, "ok", "the ordinary scheduled handler dispatches the committed maintenance notice");
    const maintenanceMail = await eventuallySubscriber(async () => messagesFor(email).find(message => message.text.includes("synthetic-lamp-020")), Boolean, "the real maintenance notice reaches Resend");
    await auditSubscriberEmails([["confirmation", messagesFor(email)[0]], ["incident update", delivered.find(message => message.text.includes(firstPublication.incident.reference))], ["maintenance notice", maintenanceMail]]);
    const audit = await api("/api/app/audit-log?action=subscriber.added&limit=100");
    assert.equal(audit.status, 200, audit.text);
    assert.equal(audit.body.entries.filter(entry => entry.entityId === id && entry.actorId === owner.id).length, 1);
    assert.ok(!audit.text.includes(email), "attributed subscriber audit entries do not copy the destination");
    const exportResponse = await fixture.request("/api/app/subscribers.csv");
    assert.equal(exportResponse.status, 200);
    const exported = subscriberCsvRows(await exportResponse.text()).find(row => row.destination === email);
    assert.equal(exported.channel, "email");
    assert.equal(exported.state, "active");
    assert.deepEqual(exported.components.split(";").sort(), [first.id, second.id].sort());
    assert.ok(Date.parse(exported.consent_at) >= confirmedAfter && Date.parse(exported.consent_at) <= confirmedBefore, "export identifies the actual confirmation instant");

    const destination = "https://receiver.example.test/synthetic-lamp-1";
    const contact = "synthetic-lamp-added-webhook@example.test";
    const webhook = await post("/api/app/subscribers", { channel: "webhook", destination, contactEmail: contact, componentIds: [second.id] });
    assert.equal(webhook.status, 201, webhook.text);
    assert.equal(webhook.body.created, true);
    assert.equal(webhook.body.confirmationSent, true);
    assert.equal(webhook.body.subscriber.state, "pending");
    assert.equal(messagesFor(contact).length, 1, "one webhook confirmation goes to its contact email");
    await fixture.publish(second, "Synthetic Lamp pending webhook publication");
    assert.equal(fixture.webhookRequests.length, 0, "the endpoint gets no update before its contact confirms");
    await fixture.confirm(contact);
    fixture.recoverWebhook();
    await fixture.publish(second, "Synthetic Lamp confirmed webhook publication");
    assert.equal(fixture.webhookRequests.length, 1);
    assert.ok(fixture.webhookRequests[0].headers["webhook-signature"]);
    assert.ok(!JSON.stringify(fixture.webhookRequests[0].body).includes(contact), "the receiver's payload carries no contact address");
    const webhookRow = (await list()).find(row => row.id === webhook.body.subscriber.id);
    assert.equal(webhookRow.state, "active");
    assert.deepEqual(webhookRow.addedBy, { id: owner.id, displayName: owner.displayName });

    const beforeInvalid = await fixture.databaseState(), mailBeforeInvalid = fixture.messages.length;
    for (const input of [
      { channel: "email", email: "synthetic-lamp-internal-add@example.test", componentIds: [internal.id] },
      { channel: "webhook", destination: "https://receiver.example.test/synthetic-lamp-2", contactEmail: "not-an-email", componentIds: [first.id] },
      { channel: "webhook", destination: "http://127.0.0.1/synthetic-lamp-1", contactEmail: "synthetic-lamp-unsafe@example.test", componentIds: [first.id] },
      { channel: "sms", phone: "2025550123", componentIds: [first.id] },
    ]) {
      const invalid = await post("/api/app/subscribers", input);
      assert.equal(invalid.status, 400, invalid.text);
    }
    await fixture.assertUnchanged(beforeInvalid);
    const crossSite = await api("/api/app/subscribers", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: JSON.stringify({ channel: "email", email: "synthetic-lamp-cross-site@example.test", componentIds: [first.id] }) });
    assert.equal(crossSite.status, 403);
    assert.equal((await fixture.raw(pageOrigin + "/api/app/subscribers", { method: "POST", body: JSON.stringify({ channel: "email", email: "synthetic-lamp-public-add@example.test", componentIds: [first.id] }) })).status, 404);
    const afterRefusal = await fixture.databaseState();
    const priorAudit = JSON.parse(beforeInvalid.get("audit_entries"));
    const currentAudit = JSON.parse(afterRefusal.get("audit_entries"));
    const addedAudit = currentAudit.filter(row => !priorAudit.includes(row));
    assert.equal(addedAudit.length, 1, "a forbidden request adds exactly its denial audit");
    const denial = JSON.parse(addedAudit[0]);
    assert.equal(denial.action, "access-denied");
    assert.equal(denial.operator_id, owner.id);
    assert.equal(denial.entity_id, "/api/app/subscribers");
    assert.ok(Number.isFinite(Date.parse(denial.created_at)));
    afterRefusal.set("audit_entries", JSON.stringify(currentAudit.filter(row => row !== addedAudit[0])));
    assert.deepEqual(afterRefusal, beforeInvalid, "refusal preserves every business row and every prior audit row");
    const refusalLog = await api(`/api/app/audit-log?action=access-denied&actorId=${owner.id}`);
    assert.equal(refusalLog.status, 200);
    assert.ok(refusalLog.body.entries.some(row => row.id === denial.id && row.actorId === owner.id && row.entityId === "/api/app/subscribers" && Number.isFinite(Date.parse(row.createdAt))), "the Owner sees the attributed denial in the audit view");
    assert.equal(fixture.messages.length, mailBeforeInvalid, "refused operator additions write no subscription and send no mail");

    const smsSettings = await api("/api/app/sms/settings");
    assert.equal(smsSettings.status, 200, smsSettings.text);
    assert.equal(smsSettings.body.configured, false, "SMS is off in a deployment without Twilio configuration");
    const subscribersBeforeUnconfiguredSms = await list();
    const unconfiguredSms = await fixture.raw(pageOrigin + "/subscribe/sms", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: pageOrigin }, body: new URLSearchParams({ phone: "+12025550171", componentId: first.id }).toString() });
    assert.equal(unconfiguredSms.status, 503);
    assert.match(await unconfiguredSms.text(), /SMS sending is not configured/);
    assert.deepEqual(await list(), subscribersBeforeUnconfiguredSms, "an unconfigured public SMS request creates no subscription");
    assert.equal(fixture.messages.length, mailBeforeInvalid, "unconfigured SMS sends no confirmation through another provider");


    await subscriberQueuedUnsubscribe({ fixture, component: first, subscriberId: id, email });
    assert.equal((await api(`/api/app/subscribers/${id}`, { method: "DELETE" })).status, 204);
    assert.equal((await api(`/api/app/subscribers/${webhook.body.subscriber.id}`, { method: "DELETE" })).status, 204);
    const erasedExport = await fixture.request("/api/app/subscribers.csv");
    assert.equal(erasedExport.status, 200);
    const erasedText = await erasedExport.text();
    for (const address of [email, contact, destination]) assert.ok(!erasedText.includes(address), "deleted destinations and contacts leave the subscriber export");
    const remaining = await fixture.databaseState();
    for (const [table, data] of remaining) for (const address of [email, contact, destination]) assert.ok(!data.includes(address), `subscriber erasure left a retained address in ${table}`);
  } finally { await fixture.close(); }
}
