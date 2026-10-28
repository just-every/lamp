import assert from "node:assert/strict";
import { eventuallyFollowUp } from "./follow-ups-runtime.mjs";

/** Only the transaction storage edge fails: application requests, durable
 * receipts, the scheduled handler, publication and notification paths are real. */
export async function automationRetryFlow({ fixture, target, wording, resolvedWording, saveRule, send, pingdom, incident, publicState, subscriberMail, email, t }) {
  const { db, api, post } = fixture;
  const made = await post("/api/app/intake/sources", { name: "Synthetic Lamp durable rule source", preset: "pingdom", componentId: target.id, credentialKind: "bearer-token" });
  assert.equal(made.status, 201, made.text);
  const source = made.body.source;
  const saved = await post("/api/app/incident-templates", { name: "Synthetic Lamp retry template", lifecycle: "Identified", ...wording, nextUpdateOffsetMinutes: 15, components: [{ componentId: target.id, state: "Degraded performance", relationship: "Primary" }], channels: ["email"], resolvedUpdate: resolvedWording });
  assert.equal(saved.status, 201, saved.text);
  const rule = await saveRule(source, target, { name: "Synthetic Lamp durable publication", mode: "claim-and-publish", state: "Degraded performance", templateId: saved.body.template.id });
  const failStorage = () => db.prepare("CREATE TRIGGER synthetic_rule_publish_fault BEFORE INSERT ON incident_updates WHEN NEW.automation_attribution LIKE 'rule Synthetic Lamp durable publication,%' BEGIN SELECT RAISE(ABORT,'Synthetic transaction storage interruption'); END").run();
  const restoreStorage = () => db.prepare("DROP TRIGGER synthetic_rule_publish_fault").run();
  const tick = async () => assert.equal((await (await fixture.runtime.getWorker()).scheduled({ cron: "* * * * *", scheduledTime: Date.now() + 61_000 })).outcome, "ok");
  const receiptFor = async key => (await api("/api/app/intake/receipts")).body.receipts.find(row => row.sourceId === source.id && row.deduplicationKey === key);
  const runFor = async id => (await api("/api/app/intake/rule-runs")).body.runs.find(run => run.ruleId === rule.id && run.sourceIncidentId === id);
  const before = subscriberMail(email).length;
  const body = pingdom("interrupted-publication");
  await failStorage();
  const failed = await send(source, body);
  assert.equal(failed.status, 500, "a rejected atomic publication remains an error");
  const receipt = await receiptFor("interrupted-publication");
  assert.match(receipt.error, /Automatic rule action.*retry/i, "the interrupted action is visible in the native receipt view");
  let work = await db.prepare("SELECT completed_at,attempts,last_error FROM alert_rule_work WHERE receipt_id=?").bind(receipt.id).first();
  assert.equal(work.completed_at, null); assert.equal(work.attempts, 1); assert.ok(work.last_error);
  const run = await runFor(receipt.incidentId);
  assert.equal((await incident(run.incidentId)).updates.length, 0);
  assert.equal(await publicState(target.id), "Operational");
  assert.equal(subscriberMail(email).length, before, "failed publication records no recipient or outbound email");
  await restoreStorage();
  await tick();
  assert.equal((await incident(run.incidentId)).updates.length, 1, "Cron resumes retained work without another alert request");
  await eventuallyFollowUp(() => subscriberMail(email).length, count => count === before + 1, "the resumed atomic publication sends once");
  work = await db.prepare("SELECT completed_at,last_error FROM alert_rule_work WHERE receipt_id=?").bind(receipt.id).first();
  assert.ok(work.completed_at); assert.equal(work.last_error, null);
  assert.equal((await send(source, body)).status, 202);
  await tick();
  assert.equal((await incident(run.incidentId)).updates.length, 1);
  assert.equal(subscriberMail(email).length, before + 1, "alert and Cron redelivery preserve the committed publication marker");
  assert.equal((await send(source, pingdom("interrupted-publication", true))).status, 202);
  await eventuallyFollowUp(() => subscriberMail(email).length, count => count === before + 2, "the resumed incident still publishes its saved resolution once");

  await failStorage();
  assert.equal((await send(source, pingdom("recovered-before-publication"))).status, 500);
  const early = await receiptFor("recovered-before-publication");
  const unstarted = await runFor(early.incidentId);
  assert.equal((await send(source, pingdom("recovered-before-publication", true))).status, 202);
  assert.ok((await runFor(early.incidentId)).releasedAt, "recovery closes an interrupted, never-published execution");
  await restoreStorage();
  await tick();
  assert.equal((await incident(unstarted.incidentId)).updates.length, 0, "retry cannot publish stale firing text after recovery");
  assert.equal(await publicState(target.id), "Operational");
  assert.equal(subscriberMail(email).length, before + 2);
  t.diagnostic("AUTO-001 durable work: a transaction rejection is visible, Cron resumes it without redelivery, and recovery before the first publication closes the private run without late text or duplicate notifications.");
}

/** A rule edit keeps the published alert episode through its real recovery. */
export async function automationEditFlow({ fixture, target, template, wording, resolvedWording, saveRule, send, pingdom, incident, publicState, subscriberMail, email, publicText, runs, runFor }) {
  const made = await fixture.post("/api/app/intake/sources", { name: "Synthetic Lamp edited rule source", preset: "pingdom", componentId: target.id, credentialKind: "bearer-token" });
  assert.equal(made.status, 201, made.text);
  const source = made.body.source;
  const input = { name: "Synthetic Lamp edited publication", mode: "claim-and-publish", state: "Degraded performance", templateId: template.id };
  const rule = await saveRule(source, target, input);
  const before = subscriberMail(email).length;
  const first = await send(source, pingdom("edited-publication"));
  assert.equal(first.status, 202, JSON.stringify(first.body));
  const run = await runFor(first.body.incidentId, rule.id);
  assert.ok(run?.firingUpdateId);
  const initial = await incident(run.incidentId);
  await eventuallyFollowUp(() => subscriberMail(email).length, count => count === before + 1, "one firing email before the rule edit");
  await saveRule(source, target, { ...input, name: `${input.name} renamed` });
  assert.equal(await publicState(target.id), input.state, "editing a published firing rule retains its public claim");
  assert.equal((await runFor(first.body.incidentId, rule.id)).releasedAt, null, "the published run remains open until recovery");
  assert.equal((await send(source, pingdom("edited-publication", false, { repeatedDelivery: 1 }))).status, 202);
  const episodes = (await runs()).filter(row => row.ruleId === rule.id);
  assert.equal(episodes.length, 1, "a repeated firing after an edit uses the same incident");
  assert.equal((await incident(run.incidentId)).updates.length, 1);
  assert.equal(subscriberMail(email).length, before + 1, "the rule edit and firing repeat send no second firing email");
  await saveRule(source, target, { ...input, name: `${input.name} paused`, mode: "draft", templateId: null });
  assert.equal(await publicState(target.id), input.state, "future draft behavior does not end an already published firing incident");
  assert.equal((await send(source, pingdom("edited-publication", true))).status, 202);
  const recovered = await incident(run.incidentId);
  assert.equal(recovered.lifecycle, "Resolved");
  assert.equal(recovered.updates.length, 2);
  const resolution = recovered.updates.find(row => row.lifecycle === "Resolved");
  assert.ok(resolution);
  for (const [field, value] of Object.entries(resolvedWording)) assert.equal(resolution[field], value);
  assert.equal(resolution.automationAttribution, initial.updates[0].automationAttribution, "recovery keeps the approval that published the incident");
  assert.equal(resolution.authorOperatorId, initial.updates[0].authorOperatorId);
  assert.equal(await publicState(target.id), "Operational");
  const publicIncidents = JSON.parse(await publicText("/api/public/v1/incidents")).data;
  assert.equal(publicIncidents.filter(row => episodes.some(episode => episode.incidentId === row.id)).length, 1, "exactly one incident for the edited alert is public");
  for (const path of [`/incidents/${recovered.reference}`, "/history"]) {
    const artifact = await publicText(path);
    assert.ok(artifact.includes(resolvedWording.customerImpact), "the same public incident has the saved recovery wording");
    assert.ok(!artifact.includes(rule.approvedByName), "recovery does not disclose the approving operator");
  }
  await eventuallyFollowUp(() => subscriberMail(email).length, count => count === before + 2, "the edited incident sends one recovery email");
  const records = (await fixture.db.prepare("SELECT incident_update_id FROM notification_delivery_records WHERE subscriber_id IN (SELECT id FROM subscribers WHERE channel='email')").all()).results;
  assert.equal(records.filter(row => row.incident_update_id === run.firingUpdateId).length, 1);
  assert.equal(records.filter(row => row.incident_update_id === resolution.id).length, 1);
  assert.equal((await send(source, pingdom("edited-publication", true))).status, 202);
  assert.equal(subscriberMail(email).length, before + 2, "repeated recovery sends no second recovery email");

  // An unpublished run released by an edit consumes the still-firing episode.
  const claimInput = { name: "Synthetic Lamp edited claim", mode: "claim", state: "Degraded performance", templateId: null };
  await saveRule(source, target, claimInput);
  const claim = await send(source, pingdom("edited-claim"));
  assert.equal(claim.status, 202);
  await saveRule(source, target, { ...claimInput, name: `${claimInput.name} renamed` });
  const beforeRepeat = (await runs()).filter(row => row.sourceIncidentId === claim.body.incidentId && row.ruleId === rule.id);
  assert.equal((await send(source, pingdom("edited-claim", false, { repeatedDelivery: 1 }))).status, 202);
  assert.deepEqual((await runs()).filter(row => row.sourceIncidentId === claim.body.incidentId && row.ruleId === rule.id), beforeRepeat, "a firing run ended by an edit cannot reopen as a new episode");
  assert.equal((await send(source, pingdom("edited-claim", true))).status, 202);
}
