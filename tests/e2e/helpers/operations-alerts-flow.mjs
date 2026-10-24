import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openFollowUpsRuntime, eventuallyFollowUp } from "./follow-ups-runtime.mjs";

/** Real application HTTP/Queue doors; only documented vendor hosts are fake. */
export async function operationsAlertsFlow({ t }) {
  const outbound = [];
  const fixture = await openFollowUpsRuntime({ providerEdge: async request => {
    const url = new URL(request.url);
    if (url.host === "synthetic-lamp-1.atlassian.net") {
      assert.equal(url.href, "https://synthetic-lamp-1.atlassian.net/_edge/tenant_info");
      assert.equal(request.headers.has("authorization"), false, "site discovery sends no credential");
      return Response.json({ cloudId: "00000000-0000-4000-8000-000000000001" });
    }
    if (["api.atlassian.com", "api.opsgenie.com"].includes(url.host)) {
      assert.equal(request.method, "POST");
      const isJsm = url.host === "api.atlassian.com";
      assert.equal(request.headers.get("authorization"), isJsm ? `Basic ${Buffer.from("synthetic-lamp-1@example.test:synthetic-lamp-key-1").toString("base64")}` : "GenieKey synthetic-lamp-key-2");
      assert.match(url.pathname, isJsm ? /^\/jsm\/ops\/api\/00000000-0000-4000-8000-000000000001\/v1\/alerts\/synthetic-lamp-1\/(notes|close)$/ : /^\/v2\/alerts\/synthetic-lamp-2\/(notes|close)$/);
      outbound.push({ provider: isJsm ? "jsm" : "opsgenie", endpoint: url.pathname.split("/").at(-1), alertId: url.pathname.split("/").at(-2), url: url.href, body: await request.json() });
      return Response.json({ requestId: `synthetic-lamp-${outbound.length}` }, { status: 202 });
    }
  } });
  const { api, post, raw, publicOrigin } = fixture;
  const component = async name => {
    const response = await post("/api/app/components", { name, groupId: null, description: "", internal: false, displayOrder: 0, note: "" });
    assert.equal(response.status, 201, response.text); return response.body.component;
  };
  try {
    for (const preset of ["jsm", "opsgenie"]) {
      const recorded = JSON.parse(await readFile(new URL(`../../fixtures/operations/${preset}-create.json`, import.meta.url), "utf8"));
      const apiComponent = await component(`synthetic-lamp-${preset}-API`), entityComponent = await component(`synthetic-lamp-${preset}-entity`), serviceComponent = await component(`synthetic-lamp-${preset}-service`);
      const compoundComponent = await component(`synthetic-lamp-${preset}-compound`);
      const matchers = [{ componentId: compoundComponent.id, labels: { tag: "component:api", entity: "synthetic-lamp-entity-1" } }, { componentId: apiComponent.id, labels: { tag: "component:api" } }, { componentId: entityComponent.id, labels: { entity: "synthetic-lamp-entity-1" } }, ...(preset === "jsm" ? [{ componentId: serviceComponent.id, labels: { affected_service: "synthetic-lamp-service-1" } }] : [])];
      const input = { name: `synthetic-lamp-${preset}`, preset, credentialKind: "bearer-token", labelMatchers: matchers, closeAlertOnResolve: true, operationsApiKey: preset === "jsm" ? "synthetic-lamp-key-1" : "synthetic-lamp-key-2", ...(preset === "jsm" ? { atlassianSite: "https://synthetic-lamp-1.atlassian.net", atlassianEmail: "synthetic-lamp-1@example.test" } : {}) };
      if (preset === "jsm") for (const site of ["https://evil.example.test", "https://a.atlassian.net.evil.example.test", "https://a.atlassian.net/path", "http://a.atlassian.net", "https://user@a.atlassian.net"]) assert.equal((await post("/api/app/intake/sources", { ...input, atlassianSite: site })).status, 400, "non-site destination is refused before connecting");
      const made = await post("/api/app/intake/sources", input); assert.equal(made.status, 201, made.text);
      const source = made.body.source;
      assert.equal(source.responderConnection, "connected"); assert.equal(source.closeAlertOnResolve, true);
      for (const secret of [input.operationsApiKey, input.atlassianEmail, source.token].filter(Boolean)) assert.ok(!(await api("/api/app/intake/sources")).text.includes(secret), "listing never returns credentials");
      const send = async (payload, token = source.token, path = source.endpointPath) => {
        const response = await raw(publicOrigin + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
        const body = await response.json(); return { status: response.status, body };
      };
      const reader = `synthetic-lamp-${preset}-reader@example.test`;
      const addedReader = await post("/api/app/subscribers", { channel: "email", email: reader, componentIds: [apiComponent.id] });
      assert.equal(addedReader.status, 201, addedReader.text);
      const confirmation = fixture.messages.find(message => message.to.includes(reader) && message.text.includes("/confirm-subscription/"));
      assert.ok(confirmation);
      const confirmationUrl = confirmation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
      assert.equal((await raw(confirmationUrl)).status, 200, "an actual active subscriber witnesses private-only late events");
      const partialMatch = { ...recorded, alert: { ...recorded.alert, alertId: `synthetic-lamp-${preset}-partial`, entity: "synthetic-lamp-other" } };
      const partial = await send(partialMatch); assert.equal(partial.status, 202);
      assert.ok(!(await api(`/api/app/incidents/${partial.body.incidentId}`)).body.incident.components.some(row => row.componentId === compoundComponent.id), "one label alone cannot satisfy a compound matcher");
      const receiptsBefore = (await api("/api/app/intake/receipts")).body.receipts.length;
      const unchangedTables = async () => Object.fromEntries(await Promise.all(["incidents", "incident_drafts", "incident_updates", "audit_entries", "alert_receipts"].map(async table => [table, (await fixture.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results])));
      const beforeRefusal = await unchangedTables();
      assert.equal((await send(recorded, "wrong-synthetic-lamp-token")).status, 401);
      assert.deepEqual(await unchangedTables(), beforeRefusal, `${preset}: wrong-token 401 changes no incident, draft, update, audit entry or receipt`);
      assert.equal((await send(recorded, null, `${source.endpointPath}/${source.token}`)).status, 401, "operations requires the custom bearer header");
      assert.deepEqual(await unchangedTables(), beforeRefusal, `${preset}: a token in the wrong door also changes no tables`);
      assert.equal((await api("/api/app/intake/receipts")).body.receipts.length, receiptsBefore, "wrong token records nothing");
      const created = await send(recorded); assert.equal(created.status, 202);
      const id = created.body.incidentId;
      const replay = await send(recorded); assert.equal(replay.body.replayed, true); assert.equal(replay.body.incidentId, id);
      const refreshedTitle = `synthetic-lamp-${preset}-refreshed`;
      const firstVersion = (await api(`/api/app/incidents/${id}`)).body.incident.draft.id;
      const repeatedCreate = await send({ ...recorded, alert: { ...recorded.alert, message: refreshedTitle }, timestamp: "2026-10-24T01:01:00.000Z" }); assert.equal(repeatedCreate.body.incidentId, id, "alertId dedup survives distinct events");
      const incident = (await api(`/api/app/incidents/${id}`)).body.incident;
      assert.deepEqual(incident.components.map(row => row.componentId).sort(), matchers.map(row => row.componentId).sort());
      assert.equal(incident.updates.length, 0);
      assert.equal(incident.title, refreshedTitle, "repeat Create refreshes the existing private draft");
      assert.notEqual(incident.draft.id, firstVersion, "title refresh invalidates the prior composer version");
      const authored = await api(`/api/app/incidents/${id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Investigating", affectedAudience: "synthetic-lamp-operator-authored-audience", customerImpact: "synthetic-lamp-operator-authored-impact", whatStillWorks: "", details: "synthetic-lamp-operator-authored-details", nextUpdateAt: new Date(Date.now() + 3600000).toISOString() }) });
      assert.equal(authored.status, 200, authored.text);
      assert.equal((await send({ ...recorded, alert: { ...recorded.alert, message: "synthetic-lamp-third-source-title" }, timestamp: "2026-10-24T01:01:30.000Z" })).body.incidentId, id);
      const preserved = (await api(`/api/app/incidents/${id}`)).body.incident;
      assert.equal(preserved.title, refreshedTitle, "operator-authored draft keeps its reviewed context");
      assert.equal(preserved.draft.affectedAudience, "synthetic-lamp-operator-authored-audience");
      assert.equal(preserved.draft.customerImpact, "synthetic-lamp-operator-authored-impact");
      assert.equal(preserved.draft.details, "synthetic-lamp-operator-authored-details");
      assert.equal((await send({ ...recorded, alert: { ...recorded.alert, tags: [], entity: "other", affectedServices: [] }, timestamp: "2026-10-24T01:02:00.000Z" })).status, 400);
      const privateNote = `synthetic-lamp-${preset}-private-note`;
      for (const action of ["Acknowledge", "Escalate", "AddNote"]) {
        const sent = await send({ ...recorded, action, timestamp: `2026-10-24T01:0${action === "Acknowledge" ? 3 : action === "Escalate" ? 4 : 5}:00.000Z`, ...(action === "AddNote" ? { alert: { ...recorded.alert, note: privateNote } } : {}) }); assert.equal(sent.status, 202);
      }
      const brief = (await api(`/api/app/incidents/${id}/brief`)).body.brief;
      for (const action of ["Acknowledge", "Escalate"]) {
        const entry = brief.whatWeKnow.alerts.find(row => row.payload?.action === action);
        assert.ok(entry, `${action} appears in the brief`); assert.match(entry.evidenceSummary, /Primary responder/); assert.match(entry.evidenceSummary, /2026-10-24T01:0[34]:00/);
      }
      assert.ok(!JSON.stringify(brief).includes(privateNote), "internal note never reaches DRAFT-004's brief");
      assert.ok(!brief.whatWeKnow.alerts.some(row => row.payload?.action === "AddNote"));
      assert.ok((await api(`/api/app/incidents/${id}`)).body.incident.internalNotes.some(note => note.body === privateNote), "AddNote is an internal operator note");
      const update = async lifecycle => {
        const nextUpdateAt = lifecycle === "Resolved" ? null : new Date(Date.now() + 3600000).toISOString();
        const draft = await api(`/api/app/incidents/${id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle, affectedAudience: "synthetic-lamp-1 API customers", customerImpact: "synthetic-lamp-1 requests interrupted", whatStillWorks: "synthetic-lamp-1 dashboard remains available", details: "synthetic-lamp-1 update", nextUpdateAt }) }); assert.equal(draft.status, 200, draft.text);
        const published = await post(`/api/app/incidents/${id}/publish`, { channels: [], ...(lifecycle === "Resolved" ? { overrideReason: "synthetic-lamp-1 operator verified recovery" } : {}) }); assert.equal(published.status, 200, published.text); return { ...published, nextUpdateAt };
      };
      const before = outbound.length;
      const identified = await update("Identified");
      await eventuallyFollowUp(() => outbound.length, count => count === before + 1, "one vendor note for publication");
      const identifiedRequests = outbound.slice(before);
      assert.equal(identifiedRequests.filter(call => call.provider === preset && call.endpoint === "notes").length, 1, `${preset}: non-Resolved publication sends exactly one notes request`);
      assert.equal(identifiedRequests.filter(call => call.provider === preset && call.endpoint === "close").length, 0, `${preset}: non-Resolved publication sends zero close requests`);
      assert.ok(identifiedRequests.every(call => call.provider === preset && call.alertId === recorded.alert.alertId), `${preset}: notes target the linked provider and alert id`);
      assert.ok(outbound.at(-1).body.note.includes(incident.reference)); assert.ok(outbound.at(-1).body.note.includes("synthetic-lamp-1 requests interrupted")); assert.ok(outbound.at(-1).body.note.includes(`${publicOrigin}/incidents/${incident.reference}`));
      for (const field of [incident.title, "Identified", "synthetic-lamp-1 API customers", "synthetic-lamp-1 requests interrupted", "synthetic-lamp-1 dashboard remains available", "synthetic-lamp-1 update", identified.nextUpdateAt]) assert.ok(outbound.at(-1).body.note.includes(field), `vendor note retains the published ${field}`);
      assert.ok(!JSON.stringify(outbound).includes(privateNote));
      const closed = await send({ ...recorded, action: "Close", timestamp: "2026-10-24T01:06:00.000Z" }); assert.equal(closed.status, 202); assert.equal(closed.body.incidentId, id);
      assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.lifecycle, "Identified", "provider Close leaves a published incident with operators");
      await update("Resolved");
      await eventuallyFollowUp(() => outbound.length, count => count === before + 3, "resolved publication adds one note and one close");
      const resolvedRequests = outbound.slice(before + 1);
      assert.equal(resolvedRequests.filter(call => call.provider === preset && call.endpoint === "notes").length, 1, `${preset}: Resolved publication sends exactly one notes request, counted separately`);
      assert.equal(resolvedRequests.filter(call => call.provider === preset && call.endpoint === "close").length, 1, `${preset}: opted-in Resolved publication sends exactly one close request`);
      assert.ok(resolvedRequests.every(call => call.provider === preset && call.alertId === recorded.alert.alertId), `${preset}: close and notes target the linked provider and alert id`);
      for (const post of outbound.slice(before + 1, before + 3)) {
        for (const field of [incident.reference, incident.title, "Resolved", "synthetic-lamp-1 API customers", "synthetic-lamp-1 requests interrupted", "synthetic-lamp-1 dashboard remains available", "synthetic-lamp-1 update", `${publicOrigin}/incidents/${incident.reference}`]) assert.ok(post.body.note.includes(field), "resolved note and close retain every public update field");
        assert.ok(!post.body.note.includes("Next update:"), "resolved posts carry no old next-update promise");
      }
      const publicPaths = ["/", "/history", `/incidents/${incident.reference}`, "/feed.atom", "/feed.rss", "/api/public/status", "/widget.js", "/api/v2/summary.json"];
      await eventuallyFollowUp(async () => (await raw(publicOrigin + `/incidents/${incident.reference}`)).text(), text => text.includes("Resolved"), "resolved public generation before late responder evidence");
      const publicBeforeLate = new Map();
      for (const path of publicPaths) { const response = await raw(publicOrigin + path); assert.equal(response.status, 200, path); publicBeforeLate.set(path, await response.text()); }
      const lateNote = `synthetic-lamp-${preset}-late-private-note`;
      const mailBeforeLate = fixture.messages.length, postsBeforeLate = outbound.length;
      for (const [index, action] of ["AddNote", "Acknowledge", "Escalate"].entries()) {
        const late = await send({ ...recorded, action, timestamp: `2026-10-24T01:${String(7 + index).padStart(2, "0")}:00.000Z`, ...(action === "AddNote" ? { alert: { ...recorded.alert, note: lateNote } } : {}) });
        assert.equal(late.status, 202); assert.equal(late.body.incidentId, id, "late responder evidence stays linked to its resolved incident");
      }
      const afterLate = (await api(`/api/app/incidents/${id}`)).body.incident;
      assert.equal(afterLate.lifecycle, "Resolved"); assert.equal(afterLate.updates.length, 2, "late actions neither reopen nor publish");
      assert.ok(afterLate.internalNotes.some(note => note.body === lateNote));
      const lateBrief = (await api(`/api/app/incidents/${id}/brief`)).body.brief;
      assert.ok(!JSON.stringify(lateBrief).includes(lateNote), "late AddNote stays out of model input too");
      for (const action of ["Acknowledge", "Escalate"]) assert.ok(lateBrief.whatWeKnow.alerts.some(row => row.payload?.action === action && row.payload.timestamp === `2026-10-24T01:${action === "Acknowledge" ? "08" : "09"}:00.000Z`));
      assert.equal(fixture.messages.length, mailBeforeLate, "late actions send no subscriber or operator mail");
      assert.equal(outbound.length, postsBeforeLate, "late actions send no provider notes or closes");
      for (const [path, before] of publicBeforeLate) {
        const after = await (await raw(publicOrigin + path)).text();
        assert.equal(after, before, `${path}: late actions change no public artifact`);
        for (const note of [privateNote, lateNote]) assert.ok(!after.includes(note), `${path} excludes responder notes`);
      }
      const reportDraft = await post(`/api/app/incidents/${id}/report/draft`, {});
      assert.equal(reportDraft.status, 200, reportDraft.text);
      const reportBrief = (await api(`/api/app/incidents/${id}/brief`)).body.brief;
      for (const action of ["Acknowledge", "Escalate"]) {
        const evidence = reportBrief.whatWeKnow.alerts.find(row => row.payload?.action === action);
        assert.ok(evidence);
        const citedLine = reportDraft.body.report.timeline.split("\n").find(line => line.includes(`[${evidence.ref}]`));
        assert.ok(citedLine, `${preset} report timeline cites ${action}`);
        assert.ok(citedLine.includes(evidence.payload.timestamp));
        assert.ok(citedLine.includes(action)); assert.ok(citedLine.includes("Primary responder"));
      }
      for (const note of [privateNote, lateNote]) assert.ok(!JSON.stringify(reportDraft.body).includes(note), "cited report drafts never include responder notes");
      assert.ok(!reportDraft.body.review.limitations.some(line => /Jira Service Management|Opsgenie/.test(line)), "connected vendor timeline evidence is not reported missing");
      await raw(`${fixture.appOrigin}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("* * * * *")}&time=${Date.now()}`);
      assert.equal(outbound.length, before + 3, "scheduled replay cannot repeat notes or close");
      for (const path of ["/", `/incidents/${incident.reference}`, "/feed.atom", "/feed.rss", "/api/v2/summary.json"]) assert.ok(!(await (await raw(publicOrigin + path)).text()).includes(privateNote), `${path} excludes responder notes`);
      // Close also resolves a never-published alert draft through the ordinary door.
      const second = { ...recorded, alert: { ...recorded.alert, alertId: `synthetic-lamp-${preset}-private` } };
      const pending = await send(second); assert.equal(pending.status, 202);
      assert.equal((await send({ ...second, action: "Close" })).status, 202);
      assert.equal((await api(`/api/app/incidents/${pending.body.incidentId}`)).body.incident.lifecycle, "Resolved");
    }
    const target = await component("synthetic-lamp-newrelic-1");
    const sourceResponse = await post("/api/app/intake/sources", { name: "synthetic-lamp-newrelic-1", preset: "newrelic", credentialKind: "bearer-token", componentId: target.id, labelMatchers: [{ componentId: target.id, labels: { entity_name: "synthetic-lamp-51" } }] }); assert.equal(sourceResponse.status, 201, sourceResponse.text);
    const source = sourceResponse.body.source;
    const issue = JSON.parse(await readFile(new URL("../../fixtures/operations/newrelic-workflow.json", import.meta.url), "utf8"));
    const send = payload => raw(publicOrigin + source.endpointPath, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${source.token}` }, body: JSON.stringify(payload) });
    const beforeUnmapped = (await fixture.db.prepare("SELECT count(*) n FROM incidents").first()).n;
    assert.equal((await send({ ...issue, issueId: "synthetic-lamp-52", entityNames: ["synthetic-lamp-53"] })).status, 400, "unmapped New Relic entities do not claim the source's component");
    assert.equal((await fixture.db.prepare("SELECT count(*) n FROM incidents").first()).n, beforeUnmapped, "unmapped entity creates no draft incident");
    const opened = await send(issue); assert.equal(opened.status, 202); const id = (await opened.json()).incidentId;
    assert.deepEqual((await api(`/api/app/incidents/${id}`)).body.incident.components.map(row => row.componentId), [target.id]);
    assert.equal((await send({ ...issue, state: "CLOSED" })).status, 202);
    assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.lifecycle, "Resolved");
    assert.equal((await api(`/api/app/incidents/${id}`)).body.incident.updates.length, 0);
    t.diagnostic("INTAKE-014 and INTAKE-011: bearer, alertId dedup, all component matchers, private notes/brief evidence, fixed vendor notes/close, unpublished recovery and New Relic workflow fixture passed.");
  } finally { await fixture.close(); }
}
