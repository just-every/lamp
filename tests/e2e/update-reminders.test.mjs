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

contract("INCIDENT-010", "the scheduled trigger sends one due-soon email inside the lead and none once a newer update is published", async () => {
  const committed = Date.now() + minutes(60);
  const incident = await openIncident("Sign-in latency", new Date(committed).toISOString());
  await trigger(committed - minutes(30));
  assert.deepEqual(await reminders(incident.reference), { dueSoon: 0, overdue: 0 }, "nothing before the lead");
  for (let run = 0; run < 3; run += 1) await trigger(committed - minutes(5));
  assert.deepEqual(await reminders(incident.reference), { dueSoon: 1, overdue: 0 }, "exactly one due-soon email however many times the trigger runs");
  const email = (await envelopes()).find((row) => row.message.subject.includes(incident.reference));
  assert.match(email.message.text, new RegExp(`/app/incidents/${incident.id}`), "it links to the incident's composer");

  // A newer update replaces the commitment: the old time passing sends nothing.
  await publishUpdate(incident.id, { lifecycle: "Monitoring", nextUpdateAt: new Date(committed + minutes(120)).toISOString() });
  await trigger(committed + minutes(1));
  assert.deepEqual(await reminders(incident.reference), { dueSoon: 1, overdue: 0 });
  // A resolved incident sends nothing at any time.
  await publishUpdate(incident.id, { lifecycle: "Resolved" });
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
