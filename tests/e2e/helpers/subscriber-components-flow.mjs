import assert from "node:assert/strict";
import { parse } from "parse5";
import { openSubscriberManagementFixture, eventuallySubscriber, pageOrigin } from "./subscriber-management-fixture.mjs";

/** Component choices are reconciled against saved identities, committed
 * recipients and actual transport requests, with no service-method shortcuts. */
export async function subscriberComponentsFlow() {
  const hooks = [];
  const fixture = await openSubscriberManagementFixture({ providerEdge: async request => {
    if (new URL(request.url).origin !== "https://receiver.example.test") return;
    hooks.push({ destination: request.url, body: await request.json() });
    return new Response(null, { status: 204 });
  } });
  const { api, post, raw, db } = fixture;
  try {
    const first = await fixture.createComponent("Synthetic Lamp selected service");
    const second = await fixture.createComponent("Synthetic Lamp second selected service");
    const subscribers = [];
    for (const mode of ["all", "selected"]) for (const channel of ["email", "webhook"]) {
      const address = [`synthetic-lamp-${mode}-${channel}`, "example.test"].join("@");
      const componentIds = mode === "all" ? [] : [first.id, second.id];
      let id, destination = address;
      if (channel === "email") {
        const form = new URLSearchParams({ email: address, preferencesPresent: "1" });
        for (const componentId of componentIds) form.append("componentId", componentId);
        for (const kind of ["incidents", "maintenance"]) form.append("eventKind", kind);
        const response = await raw(`${pageOrigin}/subscribe`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: pageOrigin }, body: form.toString() });
        assert.equal(response.status, 202, await response.text());
        id = (await fixture.list()).find(row => row.destination === address).id;
      } else {
        destination = `https://receiver.example.test/synthetic-lamp-${mode}`;
        const response = await post("/api/app/subscribers", { channel, destination, contactEmail: address, componentIds, eventKinds: ["incidents", "maintenance"] });
        assert.equal(response.status, 201, response.text);
        id = response.body.subscriber.id;
      }
      await fixture.confirm(address);
      if (channel === "email") {
        const response = await raw(`${pageOrigin}/subscribe`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: pageOrigin }, body: new URLSearchParams({ email: address }).toString() });
        assert.equal(response.status, 202, await response.text());
      }
      const manageUrl = fixture.messagesFor(address).map(message => message.text.match(/https?:\/\/\S+\/manage\/\S+/)?.[0]).find(Boolean);
      assert.ok(manageUrl);
      subscribers.push({ id, mode, channel, destination, manageUrl });
    }
    const savedChoices = async () => (await fixture.list()).map(row => ({
      id: row.id, state: row.state, mode: row.selectionMode,
      components: row.componentSelections.map(item => item.componentId).sort(),
    })).sort((a, b) => a.id.localeCompare(b.id));
    const expectedChoices = subscribers.map(row => ({ id: row.id, state: "active", mode: row.mode,
      components: row.mode === "all" ? [] : [first.id, second.id].sort(),
    })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(await savedChoices(), expectedChoices, "all four confirmed subscriptions preserve their exact original choices");
    const managedEmail = subscribers.find(row => row.mode === "selected" && row.channel === "email");
    const manageSelection = async componentIds => {
      const form = new URLSearchParams({ preferencesPresent: "1" });
      for (const componentId of componentIds) form.append("componentId", componentId);
      for (const kind of ["incidents", "maintenance"]) form.append("eventKind", kind);
      const response = await raw(managedEmail.manageUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: pageOrigin }, body: form.toString() });
      assert.equal(response.status, 200, await response.text());
    };
    await manageSelection([]);
    const unnarrowed = (await savedChoices()).find(row => row.id === managedEmail.id);
    assert.deepEqual(unnarrowed, { id: managedEmail.id, state: "active", mode: "all", components: [] }, "clearing management choices follows all current and future components");
    await manageSelection([first.id, second.id]);
    assert.deepEqual(await savedChoices(), expectedChoices, "management saves exactly the ticked identities again");
    const addedLater = await fixture.createComponent("Synthetic Lamp newly visible service");
    assert.deepEqual(await savedChoices(), expectedChoices, "component creation changes neither subscription mode nor narrowed identities");
    for (const subscriber of subscribers) {
      const response = await raw(subscriber.manageUrl);
      assert.equal(response.status, 200);
      const checked = [];
      const visit = node => {
        const attrs = Object.fromEntries((node.attrs ?? []).map(attr => [attr.name, attr.value]));
        if (node.tagName === "input" && attrs.name === "componentId" && Object.hasOwn(attrs, "checked")) checked.push(attrs.value);
        for (const child of node.childNodes ?? []) visit(child);
      };
      visit(parse(await response.text()));
      assert.deepEqual(checked.sort(), (subscriber.mode === "all" ? [first.id, second.id, addedLater.id] : [first.id, second.id]).sort(), "the session-free management page reflects all-visible or the exact saved narrowed identities");
    }

    const drain = async () => {
      const scheduled = await (await fixture.runtime.getWorker()).scheduled({ cron: "* * * * *" });
      assert.equal(scheduled.outcome, "ok", "the native scheduled door dispatches committed notifications");
      await eventuallySubscriber(async () => (await db.prepare("SELECT id FROM notification_outbox WHERE kind='delivery-dispatch' AND completed_at IS NULL").all()).results,
        rows => rows.length === 0, "the real Queue completes every publication dispatch before silence is asserted");
    };
    const deliveries = async () => {
      const response = await api("/api/app/deliveries?limit=100");
      assert.equal(response.status, 200, response.text);
      assert.equal(response.body.hasMore, false);
      return response.body.deliveries;
    };
    const recipient = row => ({ id: row.subscriberId, channel: row.channel, destination: row.destination });
    const recipients = rows => rows.map(recipient).sort((a, b) => a.id.localeCompare(b.id));
    const expectedRecipients = rows => rows.map(row => ({ id: row.id, channel: row.channel, destination: row.destination })).sort((a, b) => a.id.localeCompare(b.id));
    const all = subscribers.filter(row => row.mode === "all");
    const selected = subscribers.filter(row => row.mode === "selected");
    const checkpoint = () => ({ mail: fixture.messages.length, hooks: hooks.length });
    const assertSends = (before, rows, wording, event, updateId) => {
      const mail = fixture.messages.slice(before.mail);
      const received = hooks.slice(before.hooks);
      assert.deepEqual(mail.flatMap(message => message.to).sort(), rows.filter(row => row.channel === "email").map(row => row.destination).sort(), "exact mail recipients; every omitted address stays silent");
      for (const message of mail) assert.ok(message.text.includes(wording), "the selected email carries this publication's distinctive content");
      assert.deepEqual(received.map(row => row.destination).sort(), rows.filter(row => row.channel === "webhook").map(row => row.destination).sort(), "exact webhook destinations; every omitted endpoint stays silent");
      for (const request of received) {
        assert.equal(request.body.event, event);
        if (updateId) {
          assert.equal(request.body.updates.at(-1).id, updateId);
          assert.equal(request.body.updates.at(-1).customerImpact, wording);
        }
      }
    };
    const assertAccepted = async rows => {
      for (const row of rows) {
        if (row.channel === "webhook") {
          assert.equal(row.outcome, "delivered");
          assert.equal(hooks.filter(request => request.body.deliveryId === row.id).length, 1, "one receiver request matches this committed webhook delivery");
        } else {
          assert.ok(row.providerAcceptedAt, "the real mail adapter records acceptance");
          assert.equal(fixture.mailReceipts.filter(receipt => receipt.idempotencyKey === `notification/${row.id}`).length, 1, "one provider submission matches this committed email delivery");
        }
      }
    };
    const created = await post("/api/app/incidents", { title: "Synthetic Lamp new-component incident", components: [{ componentId: addedLater.id, state: "Partially unavailable", relationship: "Primary" }] });
    assert.equal(created.status, 201, created.text);
    const incident = created.body.incident;
    const publish = async wording => {
      const draft = await api(`/api/app/incidents/${incident.id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Identified", affectedAudience: "Synthetic Lamp customers", customerImpact: wording, whatStillWorks: "Other services remain available.", details: "Operators are investigating.", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() }) });
      assert.equal(draft.status, 200, draft.text);
      const response = await post(`/api/app/incidents/${incident.id}/publish`, { channels: ["email", "webhook"] });
      assert.equal(response.status, 200, response.text);
      assert.equal(response.body.update.customerImpact, wording, "publication retains the independently submitted wording used to distinguish latest-update catch-up");
      await drain();
      return response.body.update;
    };
    let before = checkpoint();
    const older = await publish("Synthetic Lamp earlier new-service disruption.");
    let rows = (await deliveries()).filter(row => row.incidentUpdateId === older.id);
    assert.deepEqual(recipients(rows), expectedRecipients(all));
    await assertAccepted(rows);
    assertSends(before, all, older.customerImpact, "incident.update.published", older.id);
    before = checkpoint();
    const latest = await publish("Synthetic Lamp latest new-service investigation.");
    rows = (await deliveries()).filter(row => row.incidentUpdateId === latest.id);
    assert.deepEqual(recipients(rows), expectedRecipients(all), "only unnarrowed subscribers follow the newly created component");
    await assertAccepted(rows);
    assertSends(before, all, latest.customerImpact, "incident.update.published", latest.id);

    // Maintenance uses the same selections. A newly added unrelated component
    // reaches only all-components controls; a selected component reaches both.
    for (const [component, wanted] of [[addedLater, all], [first, subscribers]]) {
      const title = `Synthetic Lamp maintenance ${component.name}`;
      before = checkpoint();
      const response = await post("/api/app/maintenance", { title, affectedAudience: "Synthetic Lamp customers", customerImpact: "Scheduled service interruption.", startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString(), endsAt: new Date(Date.now() + 49 * 3_600_000).toISOString(), componentIds: [component.id], autoStart: false, autoComplete: false });
      assert.equal(response.status, 201, response.text);
      await drain();
      const maintenanceId = response.body.maintenance.id;
      rows = (await deliveries()).filter(row => row.maintenanceId === maintenanceId);
      assert.deepEqual(recipients(rows), expectedRecipients(wanted), "scheduled maintenance captures only matching component recipients");
      await assertAccepted(rows);
      assertSends(before, wanted, title, "maintenance.notice.published");
      before = checkpoint();
      const started = await post(`/api/app/maintenance/${maintenanceId}/start`);
      assert.equal(started.status, 200, started.text);
      await drain();
      rows = (await deliveries()).filter(row => row.maintenanceId === maintenanceId && row.maintenanceNoticeKind === "started");
      assert.deepEqual(recipients(rows), expectedRecipients(wanted), "maintenance start retains exact component scope");
      await assertAccepted(rows);
      assertSends(before, wanted, title, "maintenance.notice.published");
      for (const request of hooks.slice(before.hooks)) {
        assert.equal(request.body.maintenance.id, maintenanceId);
        assert.equal(request.body.maintenance.notice, "started");
      }
    }

    before = checkpoint();
    const attachment = await post(`/api/app/incidents/${incident.id}/components`, { componentId: first.id, state: "Partially unavailable", relationship: "Primary" });
    assert.equal(attachment.status, 201, attachment.text);
    await drain();
    const attached = await db.prepare("SELECT id FROM incident_components WHERE incident_id=? AND component_id=?").bind(incident.id, first.id).first();
    assert.ok(attached);
    const catchup = (await db.prepare("SELECT id,subscriber_id,channel,incident_update_id,notification_event_id FROM notification_delivery_records WHERE notification_event_id=? ORDER BY subscriber_id").bind(`incident-attachment/${attached.id}`).all()).results;
    assert.deepEqual(catchup.map(row => ({ id: row.subscriber_id, channel: row.channel, update: row.incident_update_id })), selected.map(row => ({ id: row.id, channel: row.channel, update: latest.id })).sort((a, b) => a.id.localeCompare(b.id)), "each newly eligible subscriber gets only the latest update");
    rows = (await deliveries()).filter(row => row.incidentUpdateId === latest.id);
    assert.deepEqual(recipients(rows), expectedRecipients(subscribers), "existing recipients are not duplicated by catch-up");
    await assertAccepted(rows);
    assert.deepEqual(recipients((await deliveries()).filter(row => row.incidentUpdateId === older.id)), expectedRecipients(all), "older updates never become catch-up notifications");
    assertSends(before, selected, latest.customerImpact, "incident.update.published", latest.id);
    const retained = await deliveries();
    before = checkpoint();
    const reattached = await post(`/api/app/incidents/${incident.id}/components`, { componentId: second.id, state: "Partially unavailable", relationship: "Primary" });
    assert.equal(reattached.status, 201, reattached.text);
    await drain();
    assert.deepEqual(await deliveries(), retained, "another eligible attachment cannot repeat catch-up for this incident");
    assertSends(before, [], "", "incident.update.published");
    before = checkpoint();
    const subsequent = await publish("Synthetic Lamp ordinary subsequent update.");
    rows = (await deliveries()).filter(row => row.incidentUpdateId === subsequent.id);
    assert.deepEqual(recipients(rows), expectedRecipients(subscribers), "newly eligible subscribers receive ordinary subsequent publications");
    await assertAccepted(rows);
    assertSends(before, subscribers, subsequent.customerImpact, "incident.update.published", subsequent.id);
    assert.deepEqual(await savedChoices(), expectedChoices, "all incident and maintenance operations leave exact saved selections unchanged");
  } finally { await fixture.close(); }
}
