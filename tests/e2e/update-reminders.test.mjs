import { chromium } from "playwright";
import { communicationOwnerFlow } from "./helpers/communication-owner-flow.mjs";
import { execFileSync } from 'node:child_process';
import { origin } from '../dev-ingress/runtime.mjs';
import { devKey } from '../helpers/dev-key.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { requestHeaders } from "../helpers/request-headers.mjs";
import assert from "node:assert/strict";
import { after, before } from "node:test";

import { contract } from "../contract.mjs";
import { withDraftVersion } from "./draft-version-helper.mjs";
import { nativeRequest, openNativeRuntime, publicOrigin, operator } from "../dev-ingress/runtime.mjs";

// Every request opens its own connection; Wrangler CLI work can outlast an idle keep-alive socket.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const request = new Request(input, init); request.headers.set("connection", "close"); return nativeFetch(request, { referrer: request.referrer, referrerPolicy: request.referrerPolicy }); };

let cookie;
let runtime;

async function api(path, init = {}) {
  init = await withDraftVersion(path, init, (readPath) => nativeRequest(readPath, { cookie }));
  const response = await nativeRequest(path, { cookie, ...init, headers: requestHeaders(init.body ? { "Content-Type": "application/json" } : {}, init.headers) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}
const post = (path, json) => api(path, { method: "POST", body: JSON.stringify(json) });

// The Worker's scheduled entry point, run as if at `time`: the controlled clock.
async function trigger(time) {
  const response = await fetch(`${publicOrigin.replace("localhost", "127.0.0.1")}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("* * * * *")}&time=${time}`);
  assert.equal(response.status, 200, await response.text());
}
// Observe scheduled notification jobs; local mail is silently suppressed.
async function envelopes() {
  const output = execFileSync('pnpm', ['exec','wrangler','d1','execute','DB','--local','--config','wrangler.jsonc','--persist-to',runtime.state,'--json','--command',"SELECT payload_json FROM notification_outbox WHERE kind='operator-alert' AND completed_at IS NOT NULL"], {env:runtime.env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  return JSON.parse(output)[0].results.flatMap(row => {const value=JSON.parse(row.payload_json);return value.recipients.map(to=>({message:{to,subject:value.title,text:value.text}}));});
}
async function reminders(reference) {
  const rows = (await envelopes()).filter((row) => row.message.to === operator && row.message.subject.includes(reference));
  return { dueSoon: rows.filter((row) => /update due at/i.test(row.message.subject)).length, overdue: rows.filter((row) => /overdue/i.test(row.message.subject)).length };
}
async function openIncident(title, nextUpdateAt) {
  const component = (await post("/api/app/components", { groupId: null, name: title, description: "", internal: false, displayOrder: 0, note: "" })).body.component;
  const incident = (await post("/api/app/incidents", { title, components: [{ componentId: component.id, state: "Partially unavailable", relationship: "Primary" }] })).body.incident;
  await publishUpdate(incident.id, { lifecycle: "Identified", nextUpdateAt });
  return incident;
}
async function publishUpdate(incidentId, overrides) {
  const draft = { lifecycle: "Identified", affectedAudience: "Customers signing in.", customerImpact: "Sign-in is slow.", whatStillWorks: "", details: "", nextUpdateAt: null, ...overrides };
  assert.equal((await api(`/api/app/incidents/${incidentId}/draft`, { method: "PUT", body: JSON.stringify(draft) })).status, 200);
  const published = await post(`/api/app/incidents/${incidentId}/publish`, { channels: [] });
  assert.equal(published.status, 200, published.text);
}
const minutes = (count) => count * 60_000;

before(async () => {
  runtime = await openNativeRuntime();
  await runtime.start();
  await runtime.seedOperator();
  cookie = (await signInAs({origin,key:devKey})).header;
  await fetch(`${publicOrigin}/`);
});

after(async () => { await runtime?.close(); });

contract("INCIDENT-010", "INCIDENT-011 owner reminders, takeover, escalation and unowned incidents follow the original commitment", async () => {
  const committed = Date.now() + minutes(60);
  const incident = await openIncident("Sign-in latency", new Date(committed).toISOString());
  const owner = (await api("/api/app/session")).body.operator;
  async function activeOperator(email, displayName) {
    const invited = await post("/api/app/operators/invite", { email, displayName });
    assert.equal(invited.status, 202, invited.text);
    const entered = await signInAs({ origin, key: devKey, as: email });
    const response = await nativeRequest("/api/app/session", { cookie: entered.header });
    return { operator: (await response.json()).operator, cookie: entered.header };
  }
  const replacement = await activeOperator("synthetic-lamp-communication@example.test", "Synthetic Lamp communicator");
  const departing = await activeOperator("synthetic-lamp-departing@example.test", "Synthetic Lamp departing communicator");
  const initially = (await api(`/api/app/incidents/${incident.id}`)).body.incident;
  assert.equal(initially.owner.id, owner.id); assert.equal(initially.unowned, false);
  assert.equal((await nativeRequest(`/api/app/incidents/${incident.id}/owner/take-over`, { method: "POST" })).status, 401);
  await trigger(committed - minutes(30));
  assert.deepEqual(await reminders(incident.reference), { dueSoon: 0, overdue: 0 }, "nothing before the lead");
  for (let run = 0; run < 3; run += 1) await trigger(committed - minutes(5));
  assert.deepEqual(await reminders(incident.reference), { dueSoon: 1, overdue: 0 }, "exactly one due-soon email however many times the trigger runs");
  assert.deepEqual((await envelopes()).filter(row => row.message.subject.includes(incident.reference)).map(row => row.message.to), [operator], "due reminder goes only to the communication owner");
  const email = (await envelopes()).find((row) => row.message.subject.includes(incident.reference));
  assert.match(email.message.text, new RegExp(`/app/incidents/${incident.id}`), "it links to the incident's composer");

  // A newer update replaces the commitment: the old time passing sends nothing.
  await publishUpdate(incident.id, { lifecycle: "Monitoring", nextUpdateAt: new Date(committed + minutes(120)).toISOString() });
  await trigger(committed + minutes(1));
  assert.deepEqual(await reminders(incident.reference), { dueSoon: 1, overdue: 0 });
  const takeover = await nativeRequest(`/api/app/incidents/${incident.id}/owner/take-over`, { method: "POST", cookie: replacement.cookie });
  assert.equal(takeover.status, 200, await takeover.clone().text());
  assert.equal((await takeover.json()).owner.id, replacement.operator.id);
  const secondCommitment = committed + minutes(120);
  await trigger(secondCommitment - minutes(5)); await trigger(secondCommitment - minutes(5));
  const ownerDue = (await envelopes()).filter(row => row.message.subject.includes(incident.reference) && /update due at/i.test(row.message.subject));
  assert.deepEqual(ownerDue.map(row => row.message.to).sort(), [operator, replacement.operator.email].sort());
  await trigger(secondCommitment + minutes(1));
  const ownerOverdue = (await envelopes()).filter(row => row.message.subject.includes(incident.reference) && /overdue/i.test(row.message.subject));
  assert.deepEqual(ownerOverdue.map(row => row.message.to), [replacement.operator.email]);
  await trigger(secondCommitment + minutes(10)); await trigger(secondCommitment + minutes(20));
  const escalation = (await envelopes()).filter(row => row.message.subject.includes(incident.reference) && /communication escalation/i.test(row.message.subject));
  assert.deepEqual(escalation.map(row => row.message.to).sort(), [operator, replacement.operator.email, departing.operator.email].sort(), "one escalation reaches each active operator exactly once");
  const unownedIncident = await openIncident("Synthetic Lamp unowned communication", new Date(secondCommitment + minutes(60)).toISOString());
  assert.equal((await api(`/api/app/incidents/${unownedIncident.id}/owner`, { method: "PUT", body: JSON.stringify({ operatorId: departing.operator.id }) })).status, 200);
  assert.equal((await post(`/api/app/operators/${departing.operator.id}/revoke-access`, {})).status, 204);
  const listedUnowned = (await api("/api/app/overview")).body.overview.activeIncidents.find(row => row.id === unownedIncident.id);
  assert.equal(listedUnowned.unowned, true); assert.equal(listedUnowned.owner, null);
  await trigger(secondCommitment + minutes(55)); await trigger(secondCommitment + minutes(55));
  const unownedDue = (await envelopes()).filter(row => row.message.subject.includes(unownedIncident.reference));
  assert.deepEqual(unownedDue.map(row => row.message.to).sort(), [operator, replacement.operator.email].sort(), "unowned due reminder reaches every active operator once");
  assert.equal((await api(`/api/app/incidents/${incident.id}/owner`, { method: "PUT", body: JSON.stringify({ operatorId: departing.operator.id }) })).status, 404);
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext();
    const entered = await signInAs({ origin, key: devKey });
    await context.addCookies(entered.cookies.map(value => ({ ...value, url: origin })));
    const page = await context.newPage();
    await communicationOwnerFlow({ page, appUrl: origin, incident, unownedIncident, previousOwner: replacement.operator, currentOwner: owner, request: async (path, method, body) => {
      const response = await api(path, { method, body: JSON.stringify(body) });
      assert.equal(response.status, 200, response.text); return response.body;
    } });
  } finally { await browser.close(); }
  const ownershipAudit = (await api(`/api/app/audit-log?action=communication-owner-changed&limit=100`)).body;
  assert.ok(ownershipAudit.entries.some(row => row.entityId === incident.id && row.actorId === replacement.operator.id));
  const csvResponse = await nativeRequest("/api/app/audit-log?action=communication-owner-changed&format=csv", { cookie });
  const csv = await csvResponse.text();
  for (const entry of ownershipAudit.entries) assert.ok(csv.includes(entry.id));
  for (const path of ["/", `/incidents/${incident.reference}`, "/feed.atom", "/api/public/status"]) {
    const publicResponse = await fetch(`${publicOrigin}${path}`);
    assert.equal(publicResponse.status, 200, `${path} is a real public surface`);
    const publicText = await publicResponse.text();
    for (const identity of [owner, replacement.operator, departing.operator]) assert.ok(!publicText.includes(identity.displayName), `${path} never exposes the communication owner`);
    assert.doesNotMatch(publicText, /"(?:owner|unowned)"/);
  }
  const preview = await post(`/api/app/incidents/${incident.id}/draft/preview`, { lifecycle: "Monitoring", affectedAudience: "API customers", customerImpact: "Requests are delayed.", whatStillWorks: "", details: "", nextUpdateAt: new Date(secondCommitment + minutes(120)).toISOString() });
  assert.equal(preview.status, 200, preview.text);
  const subscriberEmail = JSON.stringify(preview.body.preview.email);
  for (const identity of [owner, replacement.operator, departing.operator]) assert.ok(!subscriberEmail.includes(identity.displayName), "subscriber email renderer never includes communication-owner identity");
  await publishUpdate(unownedIncident.id, { lifecycle: "Resolved" });
  // A resolved incident sends nothing at any time.
  await publishUpdate(incident.id, { lifecycle: "Resolved" });
  assert.equal((await post(`/api/app/incidents/${incident.id}/owner/take-over`, {})).status, 409);
  assert.equal((await api(`/api/app/incidents/${incident.id}/owner`, { method: "PUT", body: JSON.stringify({ operatorId: owner.id }) })).status, 409);
  await trigger(committed + minutes(115));
  await trigger(committed + minutes(125));
  assert.deepEqual(await reminders(incident.reference), { dueSoon: 1, overdue: 0 });
});

contract("INCIDENT-010", "an incident inside the lead shows as due to operators and never on the public page", async () => {
  const committed = new Date(Date.now() + minutes(5)).toISOString();
  const incident = await openIncident("Upload delays", committed);
  const listed = (await api("/api/app/incidents")).body.incidents.find((row) => row.id === incident.id);
  assert.equal(listed.updateDue, true);
  assert.equal(listed.updateDueAt, committed);
  assert.equal((await api("/api/app/overview")).body.overview.activeIncidents.find((row) => row.id === incident.id).updateDue, true);
  const page = await (await fetch(`${publicOrigin}/incidents/${incident.reference}`)).text();
  assert.match(page, /Upload delays/);
  assert.doesNotMatch(page, /\b(overdue|update due)\b/i);
});

contract("NOTIFY-006", "an overdue commitment sends one operator email from the scheduled trigger with no operator page open", async () => {
  const committed = Date.now() + minutes(30);
  const incident = await openIncident("Search errors", new Date(committed).toISOString());
  await trigger(committed + minutes(1));
  await trigger(committed + minutes(2));
  await trigger(committed + minutes(30));
  assert.deepEqual(await reminders(incident.reference), { dueSoon: 0, overdue: 1 });
});
