import { execFileSync } from "node:child_process";
import { recoveryCheckFlow } from "./helpers/recovery-check-flow.mjs";
import { test } from 'node:test';
import { requestHeaders } from "../helpers/request-headers.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { contract } from "../contract.mjs";
import { localWranglerConfig } from "../helpers/wrangler-config.mjs";
import { withDraftVersion } from "./draft-version-helper.mjs";
import { nativeRequest, openNativeRuntime, publicOrigin, origin, operator } from "../dev-ingress/runtime.mjs";
import { devKey } from '../helpers/dev-key.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';

// Every request opens its own connection; Wrangler CLI work can outlast an idle keep-alive socket.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const request = new Request(input, init); request.headers.set("connection", "close"); return nativeFetch(request, { referrer: request.referrer, referrerPolicy: request.referrerPolicy }); };

const CANARY = "CANARY-INTERNAL-NOTE-7f3a2c";
const INTERNAL_COMPONENT = "CANARY-INTERNAL-COMPONENT-91b";
const datadog = {
  down: { alert_id: "4401", alert_cycle_key: "brief-cycle-1", alert_transition: "Triggered", alert_title: "[Triggered] Checkout error rate", event_title: "Checkout error rate above 5%" },
  up: { alert_id: "4401", alert_cycle_key: "brief-cycle-1", alert_transition: "Recovered", alert_title: "[Recovered] Checkout error rate" },
};
let cookie;
let runtime;
let provider;
// The loopback receiver stands in for an OpenAI-compatible provider: it records
// each request and answers with whatever the current test sets.
const providerRequests = [];
let answer = () => ({ status: 503, body: { error: "no answer set" } });

async function api(path, init = {}) {
  init = await withDraftVersion(path, init, (readPath) => nativeRequest(readPath, { cookie }));
  const response = await nativeRequest(path, { cookie, ...init, headers: requestHeaders(init.body ? { "Content-Type": "application/json" } : {}, init.headers) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}
const post = (path, json) => api(path, { method: "POST", ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
const brief = async (incidentId) => (await api(`/api/app/incidents/${incidentId}/brief`)).body.brief;
async function component(name, internal = false) { return (await post("/api/app/components", { groupId: null, name, description: "", internal, displayOrder: 0, note: "" })).body.component; }
async function alertSource(name, componentId) {
  const created = await post("/api/app/intake/sources", { name, preset: "datadog", componentId, credentialKind: "bearer-token" });
  assert.equal(created.status, 201, created.text);
  const { token, endpointUrl } = created.body.source;
  return (payload) => fetch(endpointUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
}
function draft(overrides = {}) {
  return { lifecycle: "Investigating", affectedAudience: "Shoppers paying by card.", customerImpact: "Some card payments fail at checkout.", whatStillWorks: "Browsing and carts work.", details: "", nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString(), ...overrides };
}

before(async () => {
  provider = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      providerRequests.push(JSON.parse(body));
      const { status, body: reply, delayMs = 0 } = answer(JSON.parse(body));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (!response.destroyed) response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  runtime = await openNativeRuntime();
  const configPath = join(runtime.directory, "wrangler.json");
  await writeFile(configPath, localWranglerConfig(config => ({
    ...config, vars: { ...config.vars, AI_PROVIDER_URL: `http://127.0.0.1:${provider.address().port}/v1/chat/completions`, AI_PROVIDER_API_KEY: "brief-test-key", AI_PROVIDER_MODEL: "brief-test-model" },
  })), { mode: 0o600 });
  runtime.env.LAMP_WRANGLER_CONFIG = configPath;
  await runtime.start();
  await runtime.seedOperator();
  cookie = (await signInAs({ origin, key: devKey })).header;
  await fetch(`${publicOrigin}/`);
});

after(async () => {
  await runtime?.close();
  await new Promise((resolve) => provider?.close(resolve));
});

let alertIncident;

test("AGENT-004 DRAFT-004 DRAFT-002 DRAFT-001 — Private incident brief constrains AI suggestions without changing published state", async t => {
  t.diagnostic("DRAFT-004 — an alert's draft shows a brief of what is known and what is not, with no internal note in it");
  await (async () => {
  const checkout = await component("Checkout");
  const send = await alertSource("Datadog checkout", checkout.id);
  const accepted = await send(datadog.down);
  assert.equal(accepted.status, 202);
  alertIncident = (await accepted.json()).incidentId;
  assert.equal((await post(`/api/app/incidents/${alertIncident}/internal-notes`, { body: `On-call says ${CANARY}` })).status, 201);

  const fresh = await brief(alertIncident);
  assert.equal(fresh.whatWeKnow.alerts.length, 1);
  assert.equal(fresh.whatWeKnow.alerts[0].source, "Datadog checkout", "the alert is listed with its source");
  assert.equal(fresh.whatWeKnow.alerts[0].state, "firing");
  assert.ok(Date.parse(fresh.whatWeKnow.alerts[0].receivedAt));
  assert.deepEqual(fresh.whatWeKnow.components.map((item) => [item.name, item.state]), [["Checkout", "Major outage"]]);
  assert.deepEqual(fresh.whatWeKnow.updates, []);
  assert.deepEqual(fresh.whatWeDoNotKnowYet.map((item) => item.ref), ["Q-audience", "Q-impact", "Q-next-update", "Q-unpublished-alert"]);
  const references = [...fresh.whatWeKnow.alerts, ...fresh.whatWeKnow.components, ...fresh.whatWeDoNotKnowYet].map((item) => item.ref);
  assert.equal(new Set(references).size, references.length, "every item has its own reference");
  assert.doesNotMatch(JSON.stringify(fresh), new RegExp(CANARY));

  // A saved draft answers the audience, impact and next-update questions.
  assert.equal((await api(`/api/app/incidents/${alertIncident}/draft`, { method: "PUT", body: JSON.stringify(draft()) })).status, 200);
  assert.deepEqual((await brief(alertIncident)).whatWeDoNotKnowYet.map((item) => item.ref), ["Q-unpublished-alert"]);

  // Published with a commitment already behind it: the update is known, and the
  // monitor's recovery and the missed commitment are open questions.
  assert.equal((await api(`/api/app/incidents/${alertIncident}/draft`, { method: "PUT", body: JSON.stringify(draft({ nextUpdateAt: new Date(Date.now() - 60_000).toISOString() })) })).status, 200);
  assert.equal((await post(`/api/app/incidents/${alertIncident}/publish`, { channels: [] })).status, 200);
  assert.equal((await send(datadog.up)).status, 202);
  const published = await brief(alertIncident);
  assert.equal(published.incident.lifecycle, "Investigating", "a recovery changes no lifecycle");
  assert.deepEqual(published.whatWeKnow.updates.map((item) => [item.ref, item.lifecycle, item.customerImpact]), [["U1", "Investigating", "Some card payments fail at checkout."]]);
  assert.deepEqual(published.whatWeKnow.alerts.map((item) => [item.ref, item.state]), [["A1", "firing"], ["A2", "recovered"]]);
  assert.equal(published.whatWeKnow.alerts[0].ref, fresh.whatWeKnow.alerts[0].ref, "references stay stable as facts arrive");
  assert.deepEqual(published.whatWeDoNotKnowYet.map((item) => item.ref), ["Q-recovery", "Q-overdue"]);
  assert.doesNotMatch(JSON.stringify(published), new RegExp(CANARY));
})(t);
  t.diagnostic("DRAFT-002 — a suggestion request sends the incident brief unchanged and never an internal note or internal component");
  await (async () => {
  answer = reply(cited);
  const mixed = await post("/api/app/incidents", { title: "Payments degraded", components: [
    { componentId: (await component("Payments")).id, state: "Degraded performance", relationship: "Primary" },
    { componentId: (await component(INTERNAL_COMPONENT, true)).id, state: "Major outage", relationship: "Dependent" },
  ] });
  assert.equal(mixed.status, 201, mixed.text);
  const mixedBrief = await brief(mixed.body.incident.id);
  assert.deepEqual(mixedBrief.whatWeKnow.components.map((item) => item.name), ["Payments"]);
  assert.equal((await post(`/api/app/incidents/${mixed.body.incident.id}/ai-suggestion`)).status, 200);
  assert.doesNotMatch(JSON.stringify(providerRequests.at(-1)), new RegExp(INTERNAL_COMPONENT));

  const before = providerRequests.length;
  const suggested = await post(`/api/app/incidents/${alertIncident}/ai-suggestion`);
  assert.equal(suggested.status, 200, suggested.text);
  assert.equal(providerRequests.length, before + 1);
  const sent = providerRequests.at(-1);
  assert.deepEqual(JSON.parse(sent.messages.find((message) => message.role === "user").content), await brief(alertIncident), "the operator's brief is exactly the model input");
  assert.doesNotMatch(JSON.stringify(sent), new RegExp(CANARY));
})(t);
  t.diagnostic("DRAFT-001 — a suggestion keeps only references the brief contains, proposes no next-update time, and changes nothing public");
  await (async () => {
  answer = reply({ ...cited, nextUpdateAt: new Date(Date.now() + 600_000).toISOString(), lifecycle: "Resolved" });
  const incidentBefore = (await api(`/api/app/incidents/${alertIncident}`)).body.incident;
  const publicBefore = await surfaces();
  const suggested = await post(`/api/app/incidents/${alertIncident}/ai-suggestion`);
  assert.equal(suggested.status, 200, suggested.text);
  const { suggestion, brief: used } = suggested.body;
  assert.deepEqual(Object.keys(suggestion).sort(), ["affectedAudience", "customerImpact", "details", "whatStillWorks"], "no lifecycle and no next-update time");
  assert.deepEqual(suggestion.affectedAudience, { text: "Shoppers paying by card.", sources: ["U1", "C1"] });
  assert.deepEqual(suggestion.customerImpact.sources, [], "a reference the brief lacks, or an open question, is no source, so the field is unsourced");
  assert.deepEqual(suggestion.whatStillWorks.sources, ["U1"]);
  assert.deepEqual(used, await brief(alertIncident));
  const incidentAfter = (await api(`/api/app/incidents/${alertIncident}`)).body.incident;
  assert.equal(incidentAfter.lifecycle, incidentBefore.lifecycle);
  assert.deepEqual(incidentAfter.updates, incidentBefore.updates);
  assert.deepEqual(incidentAfter.draft, incidentBefore.draft, "the saved draft changes only when the operator edits it");
  assert.deepEqual(await surfaces(), publicBefore, "page, feed and widget are byte-identical");
})(t);
  t.diagnostic("AGENT-004 — pre-close evidence, hold, re-fire, grouped members and private audited override");
  await recoveryCheckFlow({ api, post, component, alertSource, draft, origin, publicOrigin, devKey, cookie,
    sql: command => execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', runtime.state, '--config', runtime.env.LAMP_WRANGLER_CONFIG, '--command', command], { env: runtime.env, stdio: 'pipe' }),
  });
});

const reply = (fields) => () => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify(fields) } }] } });
const cited = {
  affectedAudience: { text: "Shoppers paying by card.", sources: ["U1", "C1"] },
  customerImpact: { text: "Card payments may fail at checkout.", sources: ["A99", "Q-recovery"] },
  whatStillWorks: { text: "Browsing works.", sources: ["U1", "A99"] },
  details: { text: "", sources: [] },
};
// What customers can see: the page, the feed, the widget's payload and script.
const surfaces = async () => Promise.all(["/", "/feed.atom", "/api/public/status", "/widget.js"].map(async (path) => { const response = await fetch(`${publicOrigin}${path}`); return [path, response.status, Buffer.from(await response.arrayBuffer()).toString("base64")]; }));





contract("DRAFT-003", "a failing or silent provider shows its error and publishing still works; with no provider there is no request and the brief remains", async () => {
  const published = async (customerImpact) => {
    const incident = await post("/api/app/incidents", { title: `Provider outage ${customerImpact}`, components: [{ componentId: (await component(`Search ${customerImpact}`)).id, state: "Degraded performance", relationship: "Primary" }] });
    const id = incident.body.incident.id;
    assert.equal((await api(`/api/app/incidents/${id}/draft`, { method: "PUT", body: JSON.stringify(draft({ customerImpact })) })).status, 200);
    return id;
  };
  answer = () => ({ status: 500, body: { error: "provider down" } });
  const failing = await published("errors");
  const failed = await post(`/api/app/incidents/${failing}/ai-suggestion`);
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /returned 500/);
  assert.equal((await post(`/api/app/incidents/${failing}/publish`, { channels: [] })).status, 200);

  answer = () => ({ status: 200, delayMs: 21_000, body: { choices: [] } });
  const silent = await published("silence");
  const started = Date.now();
  const late = await post(`/api/app/incidents/${silent}/ai-suggestion`);
  assert.equal(late.status, 502);
  assert.ok(typeof late.body.error === "string" && late.body.error.trim().length > 0);
  assert.ok(Date.now() - started < 21_000);
  assert.equal((await post(`/api/app/incidents/${silent}/publish`, { channels: [] })).status, 200);

  // The same installation with no provider configured.
  await runtime.stop();
  await writeFile(runtime.env.LAMP_WRANGLER_CONFIG, localWranglerConfig(), { mode: 0o600 });
  await runtime.start();
  const before = providerRequests.length;
  assert.equal((await api("/api/app/ai/status")).body.configured, false);
  assert.equal((await post(`/api/app/incidents/${alertIncident}/ai-suggestion`)).status, 404);
  assert.ok((await brief(alertIncident)).whatWeKnow.alerts.length, "the brief needs no provider");
  assert.equal(providerRequests.length, before, "no outbound request");
});
