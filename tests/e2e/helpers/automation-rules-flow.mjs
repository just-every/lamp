import assert from "node:assert/strict";
import { openFollowUpsRuntime, eventuallyFollowUp } from "./follow-ups-runtime.mjs";
import { groupedPayload } from "./grouped-alerts-flow.mjs";
import { automationRetryFlow } from "./automation-retry-flow.mjs";

const ownerId = "01J00000000000000000000091";
const wording = {
  affectedAudience: "Synthetic Lamp rule API customers",
  customerImpact: "Saved rule wording: requests are slower than usual.",
  whatStillWorks: "Saved rule wording: the dashboard remains available.",
  details: "Saved rule wording: engineers are investigating the API.",
};
const resolvedWording = {
  affectedAudience: "Synthetic Lamp rule API customers",
  customerImpact: "Saved recovery wording: API requests work normally again.",
  whatStillWorks: "Saved recovery wording: all services are available.",
  details: "Saved recovery wording: recovery checks passed.",
};

/** Every product action uses authenticated operator or public intake doors.
 * Only mail and webhook provider edges are recorded by the existing fixture. */
export async function automationRulesFlow({ t }) {
  const fixture = await openFollowUpsRuntime();
  const { api, post, raw, db, publicOrigin } = fixture;
  fixture.recoverWebhook();
  const put = (path, body) => api(path, { method: "PUT", body: JSON.stringify(body) });
  const component = async name => {
    const made = await post("/api/app/components", { name, groupId: null, description: "", internal: false, displayOrder: 0, note: "" });
    assert.equal(made.status, 201, made.text);
    return made.body.component;
  };
  const source = async (target, name) => {
    const made = await post("/api/app/intake/sources", { name, preset: "pingdom", componentId: target.id, credentialKind: "bearer-token" });
    assert.equal(made.status, 201, made.text);
    return made.body.source;
  };
  const rulePath = (source, target) => `/api/app/intake/rules/${source.id}/${target.id}`;
  const send = async (source, payload, token = source.token) => {
    const response = await raw(publicOrigin + source.endpointPath, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  const pingdom = (key, recovered = false, extra = {}) => ({ check_id: key, check_name: `Synthetic Lamp rule ${key}`, current_state: recovered ? "UP" : "DOWN", previous_state: recovered ? "DOWN" : "UP", description: recovered ? "Recovered" : "Alert payload is not approved customer wording", ...extra });
  const incident = async id => {
    const response = await api(`/api/app/incidents/${id}`);
    assert.equal(response.status, 200, response.text);
    return response.body.incident;
  };
  const publicText = async path => {
    const response = await raw(publicOrigin + path);
    assert.equal(response.status, 200, `public ${path}: ${await response.clone().text()}`);
    return response.text();
  };
  const snapshot = async () => Object.fromEntries(await Promise.all(["/", "/api/public/status", "/api/public/v1/components"].map(async path => [path, await publicText(path)])));
  const publicState = async id => JSON.parse(await publicText("/api/public/v1/components")).data.find(row => row.id === id)?.state;
  const deliveries = async () => (await db.prepare("SELECT * FROM notification_delivery_records ORDER BY id").all()).results;
  const subscriberMail = email => fixture.messages.filter(message => message.to.includes(email) && !message.text.includes("/confirm-subscription/"));
  const runs = async () => {
    const response = await api("/api/app/intake/rule-runs");
    assert.equal(response.status, 200, response.text);
    return response.body.runs;
  };
  const runFor = async (sourceIncidentId, ruleId) => (await runs()).find(row => row.sourceIncidentId === sourceIncidentId && row.ruleId === ruleId);
  const changedTables = async () => {
    const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'alert_%' OR name LIKE 'incident_%' OR name LIKE 'component_%' OR name IN ('incidents','components','audit_entries','notification_deliveries','component_notification_deliveries')) ORDER BY name").all()).results.map(row => row.name);
    return Object.fromEntries(await Promise.all(names.map(async name => [name, (await db.prepare(`SELECT * FROM "${name}"`).all()).results.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))])));
  };
  const saveRule = async (source, target, input) => {
    const response = await put(rulePath(source, target), input);
    assert.equal(response.status, 200, response.text);
    return response.body.rule;
  };
  const confirm = async email => {
    const message = await eventuallyFollowUp(() => fixture.messages.find(row => row.to.includes(email) && row.text.includes("/confirm-subscription/")), Boolean, "the real subscriber confirmation arrives");
    const url = message.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)?.[0];
    assert.ok(url);
    assert.equal((await raw(url)).status, 200, "subscriber confirms through its public capability");
  };
  try {
    const target = await component("Synthetic Lamp rules API"), other = await component("Synthetic Lamp independent component");
    const monitored = await source(target, "Synthetic Lamp owner rules source"), independent = await source(target, "Synthetic Lamp independent source");
    const email = "synthetic-lamp-rules-reader@example.test";
    const emailSubscription = await post("/api/app/subscribers", { channel: "email", email, componentIds: [target.id], eventKinds: ["incidents", "components"] });
    assert.equal(emailSubscription.status, 201, emailSubscription.text);
    await confirm(email);
    const contact = "synthetic-lamp-rules-webhook@example.test";
    const webhook = await post("/api/app/subscribers", { channel: "webhook", destination: "https://receiver.example.test/synthetic-lamp-components", contactEmail: contact, componentIds: [target.id], eventKinds: ["incidents", "components"] });
    assert.equal(webhook.status, 201, webhook.text);
    await confirm(contact);

    t.diagnostic("AUTO-001 draft: no saved rule and an explicit draft rule preserve byte-identical retained public artifacts.");
    const beforeDefault = await snapshot(), beforeDefaultDeliveries = await deliveries();
    const defaultAlert = await send(monitored, pingdom("default-draft"));
    assert.equal(defaultAlert.status, 202, JSON.stringify(defaultAlert.body));
    assert.equal((await incident(defaultAlert.body.incidentId)).updates.length, 0);
    assert.deepEqual(await snapshot(), beforeDefault, "released default intake does not rebuild or change any public bytes");
    assert.deepEqual(await deliveries(), beforeDefaultDeliveries, "default draft queues no subscriber notification");
    const draftRule = await saveRule(monitored, target, { name: "Synthetic Lamp draft rule", mode: "draft", state: "Degraded performance", templateId: null });
    const beforeDraft = await snapshot();
    const explicitDraft = await send(monitored, pingdom("explicit-draft"));
    assert.equal(explicitDraft.status, 202);
    assert.equal((await incident(explicitDraft.body.incidentId)).updates.length, 0);
    assert.deepEqual(await snapshot(), beforeDraft, "choosing draft leaves the public page and JSON unchanged");
    assert.deepEqual(await deliveries(), beforeDefaultDeliveries);

    t.diagnostic("AUTO-001 validation: unauthenticated, malformed, unknown and incomplete-template rule requests change no product rows or public snapshot.");
    const invalidBefore = await changedTables(), invalidSnapshot = await snapshot();
    const denied = await raw(fixture.appOrigin + rulePath(monitored, target), { method: "PUT", headers: { "Content-Type": "application/json", Origin: fixture.appOrigin }, body: JSON.stringify({ name: "Denied rule", mode: "claim", state: "Major outage" }) });
    assert.equal(denied.status, 401);
    for (const body of [
      { name: "", mode: "claim", state: "Major outage" },
      { name: "Invalid mode", mode: "publish-everything", state: "Major outage" },
      { name: "Invalid state", mode: "claim", state: "unknown" },
      { name: "No saved template", mode: "claim-and-publish", state: "Major outage", templateId: null },
      { name: "Missing template", mode: "claim-and-publish", state: "Major outage", templateId: "01J00000000000000000000999" },
      { name: "Forged approval", mode: "claim", state: "Major outage", approvedByOperatorId: "01J00000000000000000000999" },
    ]) assert.equal((await put(rulePath(monitored, target), body)).status, 400, JSON.stringify(body));
    assert.equal((await put(`/api/app/intake/rules/invalid/${target.id}`, { name: "Invalid id", mode: "claim", state: "Major outage" })).status, 400);
    assert.equal((await send(monitored, pingdom("denied-intake"), "wrong-token")).status, 401);
    assert.deepEqual(await changedTables(), invalidBefore, "invalid or denied requests cannot mutate stored rules, receipts, drafts, claims, updates or audit");
    assert.deepEqual(await snapshot(), invalidSnapshot, "invalid or denied requests cannot advance the retained snapshot");

    t.diagnostic("AUTO-001 claim: the saved named state reaches the public component in under 30 seconds, with no update or subscriber notification, and recovery releases it.");
    const claimRule = await saveRule(monitored, target, { name: "Synthetic Lamp claim rule", mode: "claim", state: "Degraded performance", templateId: null });
    assert.equal(claimRule.id, draftRule.id, "editing a component/source replaces only that rule");
    const beforeClaimDeliveries = await deliveries(), beforeClaimMail = subscriberMail(email).length, beforeClaimWebhooks = fixture.webhookRequests.length;
    const started = performance.now();
    const firing = await send(monitored, pingdom("claim-cycle"));
    assert.equal(firing.status, 202, JSON.stringify(firing.body));
    assert.equal(await publicState(target.id), "Degraded performance", "the rule chooses its state instead of Pingdom's Major outage default");
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 30_000, `public component changed in ${elapsed.toFixed(1)}ms`);
    assert.equal(await publicState(other.id), "Operational", "the component rule does not become a global intake policy");
    const claimRun = await runFor(firing.body.incidentId, claimRule.id);
    assert.ok(claimRun);
    assert.equal((await incident(claimRun.incidentId)).updates.length, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='operator-alert' AND aggregate_id=?").bind(`intake-draft/${firing.body.incidentId}`).first()).n, 0, "a claim rule also suppresses the owner draft-review notification");
    assert.deepEqual(await deliveries(), beforeClaimDeliveries, "claim captures neither incident nor component-change subscriber deliveries");
    assert.equal(subscriberMail(email).length, beforeClaimMail);
    assert.equal(fixture.webhookRequests.length, beforeClaimWebhooks);
    const claimRepeat = await send(monitored, pingdom("claim-cycle", false, { repeatedDelivery: 1 }));
    assert.equal(claimRepeat.body.incidentId, firing.body.incidentId);
    assert.equal((await runs()).filter(row => row.sourceIncidentId === firing.body.incidentId && row.ruleId === claimRule.id).length, 1);
    const recovery = await send(monitored, pingdom("claim-cycle", true));
    assert.equal(recovery.status, 202, JSON.stringify(recovery.body));
    assert.equal(await publicState(target.id), "Operational");
    assert.equal((await incident(claimRun.incidentId)).updates.length, 0);
    assert.ok((await runFor(firing.body.incidentId, claimRule.id)).releasedAt);
    assert.deepEqual(await deliveries(), beforeClaimDeliveries, "claim recovery also sends no notification");
    assert.equal(subscriberMail(email).length, beforeClaimMail);
    assert.equal(fixture.webhookRequests.length, beforeClaimWebhooks);
    t.diagnostic(`AUTO-001 measured claim to public state: ${elapsed.toFixed(1)}ms.`);
    for (const number of [1, 2, 3]) {
      const key = `concurrent-claim-${number}`;
      assert.equal((await send(monitored, pingdom(key))).status, 202);
      const racing = await Promise.all([
        send(monitored, pingdom(key, false, { revision: 1 })),
        send(monitored, pingdom(key, true, { revision: 1 })),
      ]);
      assert.ok(racing.every(result => result.status === 202), JSON.stringify(racing));
      assert.equal((await send(monitored, pingdom(key, true, { revision: 2 }))).status, 202);
      assert.equal(await publicState(target.id), "Operational", "a final recovery cannot leave a stale concurrent firing claim");
    }
    assert.deepEqual(await deliveries(), beforeClaimDeliveries, "concurrent claim/recovery produces no subscriber delivery");

    const isolatedBefore = await snapshot();
    const isolated = await send(independent, pingdom("different-source"));
    assert.equal(isolated.status, 202);
    assert.equal((await incident(isolated.body.incidentId)).updates.length, 0);
    assert.deepEqual(await snapshot(), isolatedBefore, "a claim rule on one source does not affect another source on the same component");

    t.diagnostic("AUTO-001 claim and publish: only saved operator text is published, using saved channel selection and one publication per firing/recovery despite redelivery and Queue retries.");
    const madeTemplate = await post("/api/app/incident-templates", { name: "Synthetic Lamp approved API template", lifecycle: "Identified", ...wording, nextUpdateOffsetMinutes: 15, components: [{ componentId: target.id, state: "Degraded performance", relationship: "Primary" }], channels: ["email"], resolvedUpdate: resolvedWording });
    assert.equal(madeTemplate.status, 201, madeTemplate.text);
    const template = madeTemplate.body.template;
    assert.deepEqual(template.channels, ["email"]);
    assert.deepEqual(template.resolvedUpdate, resolvedWording);
    const publishRule = await saveRule(monitored, target, { name: "Synthetic Lamp approved publication", mode: "claim-and-publish", state: "Degraded performance", templateId: template.id });
    const beforePublicationMail = subscriberMail(email).length, beforePublicationWebhooks = fixture.webhookRequests.length;
    const automatic = await send(monitored, pingdom("publish-cycle"));
    assert.equal(automatic.status, 202, JSON.stringify(automatic.body));
    const publicationRun = await runFor(automatic.body.incidentId, publishRule.id);
    assert.ok(publicationRun?.firingUpdateId);
    let published = await incident(publicationRun.incidentId);
    assert.equal(published.updates.length, 1);
    const firingUpdate = published.updates[0];
    for (const [field, value] of Object.entries(wording)) assert.equal(firingUpdate[field], value, `publication keeps operator-authored ${field}`);
    assert.equal(firingUpdate.lifecycle, "Identified");
    const page = await publicText(`/incidents/${published.reference}`);
    for (const text of Object.values(wording)) assert.ok(page.includes(text), "the permanent public incident includes saved wording");
    assert.ok(!page.includes("Alert payload is not approved customer wording"), "alert text never becomes customer wording");
    const attribution = `rule ${publishRule.name}, approved by Synthetic Lamp owner`;
    assert.equal(firingUpdate.automationAttribution, attribution, "the atomic publication retains its approving rule attribution");
    assert.equal(firingUpdate.automationReceiptId, automatic.body.receiptId, "the internal update identifies its causal alert");
    assert.ok(published.internalNotes.some(note => note.body.includes(attribution) && note.body.includes(automatic.body.receiptId)), "internal timeline attributes approval and identifies the causal alert");
    assert.ok((await incident(automatic.body.incidentId)).internalNotes.some(note => note.body.includes(publicationRun.incidentId)), "the original alert draft links the automated incident");
    await eventuallyFollowUp(() => subscriberMail(email).length, count => count === beforePublicationMail + 1, "one subscriber email for the template's firing update");
    assert.equal(fixture.webhookRequests.length, beforePublicationWebhooks, "the template's deselected webhook channel stays silent");
    const readerDeliveries = (await deliveries()).filter(row => row.incident_update_id === firingUpdate.id);
    assert.equal(readerDeliveries.length, 1);
    assert.equal(readerDeliveries[0].channel, "email");
    for (const payload of [pingdom("publish-cycle"), pingdom("publish-cycle", false, { repeatedDelivery: 2 })]) assert.equal((await send(monitored, payload)).status, 202);
    const worker = await fixture.runtime.getWorker();
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await worker.queue("lamp-follow-ups-jobs", [{ id: `synthetic-lamp-rule-redelivery-${firingUpdate.id}-${attempt}`, timestamp: new Date(), attempts: attempt, body: { type: "delivery-dispatch", eventId: firingUpdate.id } }]);
      assert.equal(result.outcome, "ok");
    }
    assert.equal((await incident(publicationRun.incidentId)).updates.length, 1, "alert redelivery does not republish");
    assert.equal(subscriberMail(email).length, beforePublicationMail + 1, "Queue retry does not resend accepted mail");
    const recovered = await send(monitored, pingdom("publish-cycle", true));
    assert.equal(recovered.status, 202, JSON.stringify(recovered.body));
    published = await incident(publicationRun.incidentId);
    assert.equal(published.updates.length, 2);
    const resolvedUpdate = published.updates.find(row => row.lifecycle === "Resolved");
    assert.ok(resolvedUpdate);
    for (const [field, value] of Object.entries(resolvedWording)) assert.equal(resolvedUpdate[field], value);
    assert.equal(resolvedUpdate.nextUpdateAt, null);
    assert.equal(await publicState(target.id), "Operational");
    const resolvedPage = await publicText(`/incidents/${published.reference}`);
    for (const text of Object.values(resolvedWording)) assert.ok(resolvedPage.includes(text));
    await eventuallyFollowUp(() => subscriberMail(email).length, count => count === beforePublicationMail + 2, "one subscriber email for the saved Resolved update");
    assert.equal((await send(monitored, pingdom("publish-cycle", true))).status, 202);
    const redelivery = await worker.queue("lamp-follow-ups-jobs", [{ id: `synthetic-lamp-rule-recovery-${resolvedUpdate.id}`, timestamp: new Date(), attempts: 2, body: { type: "delivery-dispatch", eventId: resolvedUpdate.id } }]);
    assert.equal(redelivery.outcome, "ok");
    assert.equal((await incident(publicationRun.incidentId)).updates.length, 2);
    assert.equal(subscriberMail(email).length, beforePublicationMail + 2);
    assert.equal(fixture.webhookRequests.length, beforePublicationWebhooks);

    await groupedRuleProof({ fixture, target, other, template, saveRule, send, runs, runFor, incident, publicState, subscriberMail, email, t });

    t.diagnostic("AUTO-001 broken template: removing saved recovery wording degrades the rule visibly to draft without a claim, update or notification.");
    const broken = await put(`/api/app/incident-templates/${template.id}`, { resolvedUpdate: null });
    assert.equal(broken.status, 200, broken.text);
    const brokenBefore = await snapshot(), brokenDeliveries = await deliveries();
    const degraded = await send(monitored, pingdom("broken-template-cycle"));
    assert.equal(degraded.status, 202, JSON.stringify(degraded.body));
    assert.equal((await incident(degraded.body.incidentId)).updates.length, 0);
    assert.deepEqual(await snapshot(), brokenBefore);
    assert.deepEqual(await deliveries(), brokenDeliveries);
    const listed = await api("/api/app/intake/rules");
    assert.equal(listed.status, 200, listed.text);
    const degradedRule = listed.body.rules.find(row => row.id === publishRule.id);
    assert.ok(degradedRule.degradationReason?.trim(), "authenticated rule controls receive a visible reason for draft degradation");
    const beforeRefused = await changedTables();
    assert.equal((await put(rulePath(independent, target), { name: "Broken template cannot be approved", mode: "claim-and-publish", state: "Major outage", templateId: template.id })).status, 400);
    assert.deepEqual(await changedTables(), beforeRefused, "an incomplete saved template is refused without any write");

    t.diagnostic("AUTO-001 audit: rule create, edit and delete appear with the saving owner and valid instants through TEAM-007's audit API.");
    const beforeDelete = await api("/api/app/audit-log?limit=100");
    assert.equal(beforeDelete.status, 200, beforeDelete.text);
    const ruleAudit = beforeDelete.body.entries.filter(entry => entry.entityId === publishRule.id);
    assert.ok(ruleAudit.length >= 3, "create and each rule edit have durable audit entries");
    for (const entry of ruleAudit) {
      assert.equal(entry.actorId, ownerId);
      assert.equal(entry.actorName, "Synthetic Lamp owner");
      assert.ok(Number.isFinite(Date.parse(entry.createdAt)));
    }
    const removed = await api(rulePath(monitored, target), { method: "DELETE" });
    assert.equal(removed.status, 200, removed.text);
    const afterDelete = (await api("/api/app/audit-log?limit=100")).body.entries.filter(entry => entry.entityId === publishRule.id);
    assert.equal(afterDelete.length, ruleAudit.length + 1, "deletion adds its audit row in the same operation");
    assert.ok(afterDelete.some(entry => /delet/i.test(entry.action) && entry.actorId === ownerId && Number.isFinite(Date.parse(entry.createdAt))));
    assert.ok(!(await api("/api/app/intake/rules")).body.rules.some(row => row.id === publishRule.id));
    t.diagnostic("AUTO-001 erasure: deleting a source releases its active rule claim with append-only history, no publication and a retained audit entry.");
    const eraseRule = await saveRule(independent, target, { name: "Synthetic Lamp erased claim", mode: "claim", state: "Major outage", templateId: null });
    const beforeErasureDeliveries = await deliveries();
    const claimedForErasure = await send(independent, pingdom("erasure-cycle"));
    assert.equal(claimedForErasure.status, 202, JSON.stringify(claimedForErasure.body));
    assert.equal(await publicState(target.id), "Major outage");
    const erased = await api(`/api/app/intake/sources/${independent.id}`, { method: "DELETE" });
    assert.equal(erased.status, 200, erased.text);
    assert.equal(await publicState(target.id), "Operational", "source erasure cannot strand a public automatic claim");
    assert.deepEqual(await deliveries(), beforeErasureDeliveries, "source erasure neither publishes an update nor sends a subscriber notification");
    const transitions = (await db.prepare("SELECT previous_state,new_state FROM component_state_history WHERE component_id=? ORDER BY changed_at DESC,created_at DESC,id DESC LIMIT 1").bind(target.id).all()).results;
    assert.deepEqual(transitions, [{ previous_state: "Major outage", new_state: "Operational" }]);
    const erasedRuleAudit = (await api("/api/app/audit-log?action=deleted&limit=100")).body.entries.find(row => row.entityId === eraseRule.id);
    assert.equal(erasedRuleAudit?.actorId, ownerId);
    assert.ok(Number.isFinite(Date.parse(erasedRuleAudit.createdAt)));
    await automationRetryFlow({ fixture, target, wording, resolvedWording, saveRule, send, pingdom, incident, publicState, subscriberMail, email, t });
  } finally {
    await fixture.close();
  }
}

async function groupedRuleProof({ fixture, target, other, template, saveRule, send, runs, runFor, incident, publicState, subscriberMail, email, t }) {
  const made = await fixture.post("/api/app/intake/sources", { name: "Synthetic Lamp grouped owner rule", preset: "alertmanager", credentialKind: "bearer-token", labelMatchers: [{ componentId: target.id, labels: { service: "api" } }, { componentId: target.id, labels: { service: "dashboard" } }, { componentId: other.id, labels: { service: "cache" } }] });
  assert.equal(made.status, 201, made.text);
  const source = made.body.source;
  const rule = await saveRule(source, target, { name: "Synthetic Lamp grouped publication", mode: "claim-and-publish", state: "Degraded performance", templateId: template.id });
  const before = subscriberMail(email).length;
  const group = (states = ["firing", "firing"]) => {
    const payload = groupedPayload("synthetic-lamp-owner-rule-group", states);
    payload.alerts.push({ ...payload.alerts[0], status: "firing", fingerprint: "c3c3c3", labels: { ...payload.alerts[0].labels, service: "cache" }, endsAt: "0001-01-01T00:00:00Z" });
    payload.status = "firing";
    return payload;
  };
  const body = group();
  const first = await send(source, body);
  assert.equal(first.status, 202, JSON.stringify(first.body));
  const run = await runFor(first.body.incidentId, rule.id);
  assert.ok(run?.firingUpdateId);
  assert.equal((await incident(run.incidentId)).updates.length, 1, "two firing fingerprints share one rule publication");
  await eventuallyFollowUp(() => subscriberMail(email).length, count => count === before + 1, "one email for the grouped publication");
  assert.equal(await publicState(other.id), "Operational", "an unruled component in the same firing group remains draft-only");
  const partial = group(["resolved", "firing"]);
  assert.equal((await send(source, partial)).status, 202);
  assert.equal((await incident(run.incidentId)).updates.length, 1, "one recovered member cannot resolve the rule's still-firing component");
  assert.equal(await publicState(target.id), "Degraded performance");
  assert.equal((await send(source, body)).status, 202);
  assert.equal((await runs()).filter(row => row.sourceIncidentId === first.body.incidentId && row.ruleId === rule.id).length, 1);
  const recovered = group(["resolved", "resolved"]);
  assert.equal((await send(source, recovered)).status, 202);
  assert.equal((await incident(run.incidentId)).updates.length, 2, "recovery of this component publishes one saved Resolved update while an unruled sibling alert still fires");
  assert.equal((await send(source, recovered)).status, 202);
  assert.equal((await incident(run.incidentId)).updates.length, 2, "group recovery redelivery cannot publish twice");
  await eventuallyFollowUp(() => subscriberMail(email).length, count => count === before + 2, "one email for grouped recovery");
  assert.equal(await publicState(target.id), "Operational");
  const nextEpisode = group();
  for (const alert of nextEpisode.alerts.slice(0, 2)) alert.startsAt = "2026-10-18T00:10:00Z";
  const refired = await send(source, nextEpisode);
  assert.equal(refired.status, 202, JSON.stringify(refired.body));
  assert.equal(refired.body.incidentId, first.body.incidentId, "the unruled sibling keeps the intake group open");
  const episodes = (await runs()).filter(row => row.sourceIncidentId === first.body.incidentId && row.ruleId === rule.id);
  assert.equal(episodes.length, 2, "a later firing episode gets its own rule execution");
  const second = episodes.find(row => row.id !== run.id);
  assert.ok(second.firingUpdateId);
  assert.equal(await publicState(target.id), "Degraded performance");
  assert.equal((await send(source, recovered)).status, 202);
  assert.equal(await publicState(target.id), "Degraded performance", "redelivery of the earlier recovery cannot resolve a newer firing episode");
  const secondRecovery = group(["resolved", "resolved"]);
  for (const alert of secondRecovery.alerts.slice(0, 2)) {
    alert.startsAt = "2026-10-18T00:10:00Z"; alert.endsAt = "2026-10-18T00:15:00Z";
  }
  assert.equal((await send(source, secondRecovery)).status, 202);
  assert.equal((await incident(second.incidentId)).updates.length, 2);
  assert.equal(await publicState(target.id), "Operational");
  await eventuallyFollowUp(() => subscriberMail(email).length, count => count === before + 4, "one email for each publication in each distinct episode");
  t.diagnostic("AUTO-001 grouped alerts: two ruled fingerprints, a separately mapped unruled firing component, partial recovery, component recovery and repeated deliveries create exactly one update/email per phase.");
}
