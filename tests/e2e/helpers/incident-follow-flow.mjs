import { incidentFollowConsentFlow } from "./incident-follow-consent-flow.mjs";
import assert from "node:assert/strict";
import { openIncidentFollowFixture } from "./incident-follow-fixture.mjs";
import { incidentFollowLifecycleFlow } from "./incident-follow-lifecycle-flow.mjs";
import { seedSubscriberLimitFixture } from "./subscriber-limits-flow.mjs";
import { subscriberIdentityInventory } from "./subscriber-management-fixture.mjs";

const DAY = 86_400_000;

/** SUB-019: the complete acceptance crosses native public/operator doors. */
export async function incidentFollowFlow() {
  const fixture = await openIncidentFollowFixture();
  const { api, post, raw, db, subscribe, create, publish, messagesFor, list, scope, tick } = fixture;
  try {
    const settings = await api("/api/app/incident-follow-settings");
    assert.equal(settings.status, 200, settings.text);
    assert.equal((settings.body.settings ?? settings.body).includeReport, true, "report following defaults on");
    await fixture.setIncludeReport(false);
    const component = await fixture.createComponent("Synthetic Lamp followed API");
    for (let number = 1; number <= 6; number++) await create(component, `Synthetic Lamp earlier private incident ${number}`);
    const incident = await create(component, "Synthetic Lamp followed incident");
    const other = await create(component, "Synthetic Lamp other incident on the same component");
    assert.equal(incident.reference, "INC-7");
    assert.equal(other.reference, "INC-8");
    const hiddenComponent = await fixture.createComponent("Synthetic Lamp private follow API", true);
    const hiddenIncident = await create(hiddenComponent, "Synthetic Lamp internal-only incident");
    const hiddenDraft = await api(`/api/app/incidents/${hiddenIncident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Investigating", affectedAudience: "Internal operators", customerImpact: "Internal-only synthetic event.", whatStillWorks: "Public services are available.", details: "Private operator details.", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() }) });
    assert.equal(hiddenDraft.status, 200, hiddenDraft.text);
    assert.equal((await post(`/api/app/incidents/${hiddenIncident.id}/publish`, { channels: [] })).status, 200);
    assert.equal((await raw(`${fixture.origin}/incidents/${hiddenIncident.reference}`)).status, 404, "internal-only incidents have no public permalink");
    await publish(incident, "Synthetic Lamp INC-7 initial update.");
    await publish(other, "Synthetic Lamp INC-8 initial update.");
    const publicResponse = await raw(`${fixture.origin}/incidents/${incident.reference}`);
    const publicHtml = await publicResponse.text();
    assert.equal(publicResponse.status, 200);
    assert.match(publicHtml, /Get updates on this incident/);
    assert.match(publicHtml, /<form[^>]*method="post"[^>]*action="\/subscribe\/incident"|<form[^>]*action="\/subscribe\/incident"[^>]*method="post"/i);
    assert.ok(publicHtml.includes(`name="incidentId" value="${incident.id}"`), "initial HTML binds the form to INC-7");
    assert.ok(!publicHtml.includes('name="channel" value="sms"'), "a deployment without SMS configuration offers no SMS form");
    const email = "synthetic-lamp-follow-inc7@example.test";
    const confirmationStarted=Date.now();
    const accepted = await subscribe(incident.id, { email });
    assert.equal(accepted.status, 202, accepted.text);
    assert.equal(messagesFor(email).length, 1);
    assert.ok(Date.now()-confirmationStarted<60_000,"the confirmed provider edge receives the confirmation within sixty seconds");
    const initialCapacity = (await api("/api/app/subscribers?limit=1")).body.capacity;
    assert.ok(initialCapacity.some(row => row.channel === "all" && row.count === 1), "a real pending incident opt-in consumes one all-channel slot");
    assert.ok(initialCapacity.some(row => row.channel === "email" && row.count === 1), "the pending incident opt-in also consumes one email slot");
    const original = (await list()).find(row => row.destination === email);
    assert.equal(original.state, "pending");
    const pageSubscribe = async () => {
      const response = await raw(`${fixture.origin}/subscribe`, { method: "POST", headers: { Origin: fixture.origin, Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }).toString() });
      return { status: response.status, text: await response.text() };
    };
    const pageAccepted = await pageSubscribe();
    assert.equal(pageAccepted.status, 202, pageAccepted.text);
    const otherAccepted = await subscribe(other.id, { email });
    assert.equal(otherAccepted.status, 202, otherAccepted.text);
    const scoped = (await list()).filter(row => row.destination === email);
    const pageSubscriber = scoped.find(row => !row.incident);
    const otherSubscriber = scoped.find(row => row.incident?.id === other.id);
    assert.ok(pageSubscriber && otherSubscriber, "the same address independently follows the page and another incident");
    const pendingInventory = await subscriberIdentityInventory(fixture);
    assert.deepEqual(pendingInventory, [
      { id: original.id, channel: "email", destination: email, incidentId: incident.id },
      { id: pageSubscriber.id, channel: "email", destination: email, incidentId: null },
      { id: otherSubscriber.id, channel: "email", destination: email, incidentId: other.id },
    ].sort((left, right) => left.id.localeCompare(right.id)), "all three scopes have distinct identities in the complete paginated inventory");
    assert.deepEqual(await pageSubscribe(), pageAccepted);
    assert.deepEqual(await subscriberIdentityInventory(fixture), pendingInventory, "a page repeat preserves both incident identities and its original page identity");
    const otherRepeat = await subscribe(other.id, { email });
    assert.equal(otherRepeat.status, otherAccepted.status);
    assert.equal(otherRepeat.text, otherAccepted.text);
    assert.deepEqual(await subscriberIdentityInventory(fixture), pendingInventory, "a second-incident repeat preserves every independent scope");
    const pendingRepeat = await subscribe(incident.id, { email });
    assert.equal(pendingRepeat.status, 202);
    assert.equal(pendingRepeat.text, accepted.text, "new and pending subscriptions receive the same no-enumeration answer");
    assert.deepEqual(await subscriberIdentityInventory(fixture), pendingInventory, "a pending incident repeat creates no identity and retains every independent scope");
    assert.equal(messagesFor(email).length, 1, "a repeated pending POST reserves no second confirmation in 24 hours");
    const confirmationUrl = messagesFor(email)[0].text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
    assert.equal((await raw(confirmationUrl)).status, 200);
    const subscriber = (await list()).find(row => row.destination === email);
    assert.equal(subscriber.state, "active");
    assert.equal(subscriber.id, original.id, "confirmation activates the original incident identity");
    assert.deepEqual(await subscriberIdentityInventory(fixture), pendingInventory);
    assert.equal((await scope(subscriber.id)).incident_id, incident.id);
    assert.equal((await scope(subscriber.id)).include_report, 0);
    const activeRepeat = await subscribe(incident.id, { email });
    assert.equal(activeRepeat.status, 202);
    assert.equal(activeRepeat.text, accepted.text, "an active address receives the same no-enumeration answer");
    assert.deepEqual(await subscriberIdentityInventory(fixture), pendingInventory, "an active incident repeat creates no identity and retains every independent scope");
    const reminders = messagesFor(email).filter(message => message.subject === "You are already subscribed to Synthetic Lamp follow-ups");
    assert.equal(reminders.length, 1, "an active incident follower receives one private already-subscribed email");
    assert.match(reminders[0].text, /^You are already subscribed to Synthetic Lamp follow-ups\. Manage this subscription: https:\/\/status\.example\.test\/manage\/\S+$/, "the SUB-012 email carries its management link and nothing else");
    const repeatedActive = await subscribe(incident.id, { email });
    assert.equal(repeatedActive.status, accepted.status);
    assert.equal(repeatedActive.text, accepted.text);
    assert.deepEqual(await subscriberIdentityInventory(fixture), pendingInventory);
    assert.equal(messagesFor(email).length, 2, "incident repeats send only the original confirmation and one management email");
    for (const independent of [pageSubscriber, otherSubscriber]) {
      assert.equal((await api(`/api/app/subscribers/${independent.id}`, { method: "DELETE" })).status, 204);
    }
    assert.equal((await list()).find(row => row.id === original.id).state, "active", "removing independent scopes preserves the original active incident subscription");
    const operatorRows = await api(`/api/app/incidents/${incident.id}/subscribers`);
    assert.equal(operatorRows.status, 200, operatorRows.text);
    assert.ok(operatorRows.body.subscribers.some(row => row.id === subscriber.id && row.destination === email), "the incident's operator view lists its follower");
    assert.ok(subscriber.incident && subscriber.incident.reference === "INC-7", "SUB-011 includes the incident scope");
    assert.equal((await raw(`${fixture.origin}/api/app/incidents/${incident.id}/subscribers`)).status, 404, "subscriber addresses are unavailable on the public host");
    assert.equal((await raw(`${fixture.appOrigin}/api/app/incidents/${incident.id}/subscribers`)).status, 401, "private subscriber rows require an operator session");

    const beforeInvalid = await fixture.databaseState();
    const mailBeforeInvalid = fixture.messages.length;
    for (const [id, input, headers, status] of [
      [hiddenIncident.id, { email: "synthetic-lamp-private-follow@example.test" }, {}, 404],
      [incident.id, { email: "invalid" }, {}, 400],
      ["not-an-incident", { email: "synthetic-lamp-invalid-follow@example.test" }, {}, 400],
      [incident.id, { email: "synthetic-lamp-cross-site-follow@example.test" }, { "Sec-Fetch-Site": "cross-site" }, 403],
      [incident.id, { channel: "webhook", destination: "http://127.0.0.1/private", contactEmail: "synthetic-lamp-unsafe-follow@example.test" }, {}, 400],
      [incident.id, { channel: "webhook", destination: "https://receiver.example.test/synthetic-lamp-1", contactEmail: "invalid" }, {}, 400],
    ]) {
      const refused = await subscribe(id, input, headers);
      assert.equal(refused.status, status, refused.text);
    }
    const invalidSetting = await api("/api/app/incident-follow-settings", { method: "PATCH", body: JSON.stringify({ includeReport: "yes" }) });
    assert.equal(invalidSetting.status, 400);
    await fixture.assertProductUnchanged(beforeInvalid);
    assert.equal(fixture.messages.length, mailBeforeInvalid, "invalid and denied requests send nothing");
    assert.equal(await (await raw(`${fixture.origin}/incidents/${incident.reference}`)).text(), publicHtml, "invalid and denied requests leave the published snapshot unchanged");

    const next = await publish(incident, "Synthetic Lamp INC-7 next update.", "Identified", []);
    assert.ok(messagesFor(email).some(message => message.text.includes("Synthetic Lamp INC-7 next update.")));
    assert.ok((await fixture.deliveries(next.id)).some(row => row.subscriberId === subscriber.id && row.outcome === "delivered"));
    const beforeOther = messagesFor(email).length;
    const otherUpdate = await publish(other, "Synthetic Lamp INC-8 same-component update.");
    assert.equal(messagesFor(email).length, beforeOther);
    assert.ok(!(await fixture.deliveries(otherUpdate.id)).some(row => row.subscriberId === subscriber.id), "INC-8 captures no INC-7 recipient");
    const maintenance = await post("/api/app/maintenance", {
      title: "Synthetic Lamp unrelated maintenance", affectedAudience: "Synthetic Lamp API readers", customerImpact: "Requests may be interrupted.",
      startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString(),
      componentIds: [component.id], autoStart: false, autoComplete: false,
    });
    assert.equal(maintenance.status, 201, maintenance.text);
    await tick();
    assert.equal((await post(`/api/app/maintenance/${maintenance.body.maintenance.id}/start`)).status, 200);
    await tick();
    assert.equal(messagesFor(email).length, beforeOther, "maintenance scheduling and start send nothing to an incident follower");
    const componentChanged = await api(`/api/app/components/${component.id}/standing-claim`, { method: "PUT", body: JSON.stringify({ state: "Degraded performance" }) });
    assert.equal(componentChanged.status, 200, componentChanged.text);
    await tick();
    assert.equal(messagesFor(email).length, beforeOther, "a component change sends nothing to an incident follower");
    await publish(incident, "Synthetic Lamp INC-7 delivered resolution.", "Resolved");
    assert.ok(messagesFor(email).some(message => message.text.includes("Synthetic Lamp INC-7 delivered resolution.")));
    assert.ok((await scope(subscriber.id)).ended_at, "following without a report ends after the resolution is delivered");
    const resolutionCount = messagesFor(email).length;
    await publish(incident, "Synthetic Lamp INC-7 update after ending.", "Investigating");
    assert.equal(messagesFor(email).length, resolutionCount, "nothing is sent after the delivered resolution ends following");
    const endedAt = Date.parse((await scope(subscriber.id)).ended_at);
    await tick(endedAt + DAY);
    await fixture.erased(email, "INC-7's ended address is gone within 24 hours");

    await incidentFollowLifecycleFlow(fixture, component);
    await proveIncidentWebhookAndErasure(fixture, incident);
    await incidentFollowConsentFlow(fixture, incident, other);
    await proveIncidentFullChannel(fixture, incident);
  } finally { await fixture.close(); }
}

async function proveIncidentWebhookAndErasure(fixture, incident) {
  const contactEmail = "synthetic-lamp-follow-webhook-contact@example.test";
  const destination = "https://receiver.example.test/synthetic-lamp-1";
  const result = await fixture.subscribe(incident.id, { channel: "webhook", destination, contactEmail });
  assert.equal(result.status, 202, result.text);
  const row = (await fixture.list()).find(row => row.destination === destination);
  assert.equal(row.state, "pending", "webhook contacts require the existing confirmation policy");
  await fixture.publish(incident, "Synthetic Lamp webhook before consent.");
  assert.equal(fixture.webhookRequests.length, 0, "an unconfirmed incident webhook receives nothing");
  await fixture.confirm(contactEmail);
  const alternateContact = "synthetic-lamp-follow-webhook-alternate@example.test";
  const repeated = await fixture.subscribe(incident.id, { channel: "webhook", destination, contactEmail: alternateContact });
  assert.equal(repeated.status, 202, repeated.text);
  assert.equal(fixture.messagesFor(alternateContact).length, 0, "repeating an endpoint cannot divert its management token to a different contact");
  const retained = (await fixture.list()).find(item => item.id === row.id);
  assert.equal(retained.contactEmail, contactEmail, "the stored webhook contact retains authority");
  await fixture.publish(incident, "Synthetic Lamp webhook after consent.");
  assert.equal(fixture.webhookRequests.length, 1);
  assert.ok(!JSON.stringify(fixture.webhookRequests[0]).includes(contactEmail));
  const invitation = fixture.messagesFor(contactEmail).find(message => /\/confirm-subscription\//.test(message.text));
  const unsubscribeUrl = invitation.text.match(/https?:\/\/\S+\/unsubscribe\/\S+/)[0];
  const optedOut = await fixture.raw(unsubscribeUrl, { method: "POST", headers: { Origin: fixture.origin, Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded" }, body: "action=unsubscribe" });
  assert.equal(optedOut.status, 200, "the contact's mailed token unsubscribes its incident webhook");
  const confirmationCount = fixture.messagesFor(contactEmail).filter(message => /\/confirm-subscription\//.test(message.text)).length;
  assert.equal((await fixture.subscribe(incident.id, { channel: "webhook", destination, contactEmail })).status, 202);
  const invitations = fixture.messagesFor(contactEmail).filter(message => /\/confirm-subscription\//.test(message.text));
  assert.equal(invitations.length, confirmationCount + 1, "mailed unsubscribe restores the incident webhook contact's shared confirmation allowance");
  const freshConfirmation = invitations.at(-1).text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
  assert.equal((await fixture.raw(freshConfirmation)).status, 200);

  assert.equal((await fixture.api(`/api/app/subscribers/${row.id}`, { method: "DELETE" })).status, 204);
  await fixture.erased(contactEmail, "operator erasure clears the incident webhook contact");
  await fixture.erased(destination, "operator erasure clears the incident webhook endpoint");
  const before = fixture.webhookRequests.length;
  await fixture.publish(incident, "Synthetic Lamp webhook after erasure.");
  assert.equal(fixture.webhookRequests.length, before, "erasure prevents later incident webhook calls");
}

async function proveIncidentFullChannel(fixture, incident) {
  const count = Number((await fixture.db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE state IN ('pending','active')").first()).n);
  console.log(`SUB-019: capacity setup from ${count} to 25,000`);
  await seedSubscriberLimitFixture(fixture.db, 1, 25_000 - count);
  console.log("SUB-019: capacity fixture is full");
  const before = await fixture.databaseState(), mail = fixture.messages.length;
  const responses = [];
  for (const email of ["synthetic-lamp-full-incident-new@example.test", "synthetic-lamp-limit-1@example.test"]) {
    const result = await fixture.subscribe(incident.id, { email });
    assert.equal(result.status, 409, result.text);
    assert.match(result.text, /cannot take new subscriptions on that channel right now/);
    assert.match(result.text, /href="\/feed\.atom"/);
    assert.match(result.text, /href="\/feed\.rss"/);
    responses.push(result.text);
  }
  assert.equal(responses[0], responses[1], "full-channel responses do not enumerate an address");
  await fixture.assertProductUnchanged(before);
  assert.equal(fixture.messages.length, mail, "the full incident form creates and sends nothing");
  const capacity = (await fixture.api("/api/app/subscribers?limit=1")).body.capacity;
  assert.ok(capacity.some(row => row.channel === "all" && row.count === 25_000), "incident subscriptions count toward SUB-020");
}
