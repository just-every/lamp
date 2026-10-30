import { automationFlapFlow } from "./helpers/automation-flap-flow.mjs";
import { automationRulesBrowserFlow } from "./helpers/automation-rules-browser-flow.mjs";
import { automationRulesFlow } from "./helpers/automation-rules-flow.mjs";
import { socialBrowserFlow } from "./helpers/social-browser-flow.mjs";
import { socialPostsFlow } from "./helpers/social-posts-flow.mjs";
import { metricsFlow } from "./helpers/metrics-flow.mjs";
import { metricSetupJourney } from "./helpers/metric-setup-journey.mjs";
import { monitorSetupJourney } from "./helpers/monitor-setup-journey.mjs";
import { operationsAlertsFlow } from "./helpers/operations-alerts-flow.mjs";
import { selfServeChatFlow } from "./helpers/self-serve-chat-flow.mjs";
import { channelDeletionFlow } from "./helpers/channel-deletion-flow.mjs";
import { channelsBrowserFlow } from "./helpers/channels-browser-flow.mjs";
import { presetRecoveryFlow } from "./helpers/preset-recovery-flow.mjs";
import { uptimePresetFlow } from "./helpers/uptime-preset-flow.mjs";
import { uptimePairingFlow } from "./helpers/uptime-pairing-flow.mjs";
import { openFollowUpsRuntime, eventuallyFollowUp } from "./helpers/follow-ups-runtime.mjs";
import { groupedAlertsFlow } from "./helpers/grouped-alerts-flow.mjs";
import { pagerDutyFlow } from "./helpers/pagerduty-flow.mjs";
import { UPDATE_LINK_FIELDS } from "./helpers/update-component-flow.mjs";
import { LINKED_URL, assertLinkedSlackText } from "./helpers/update-link-evidence.mjs";
import { test } from 'node:test';
import { requestHeaders } from "../helpers/request-headers.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before } from "node:test";
import { randomBytes } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { localWranglerConfig } from "../helpers/wrangler-config.mjs";

// Wrangler CLI work between requests can outlast an idle keep-alive socket; every request opens its own connection.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const request = new Request(input, init); request.headers.set("connection", "close"); return nativeFetch(request, { referrer: request.referrer, referrerPolicy: request.referrerPolicy }); };
import { withDraftVersion } from "./draft-version-helper.mjs";
import { nativeRequest, openNativeRuntime, publicOrigin, origin, operator } from "../dev-ingress/runtime.mjs";
import { devKey } from '../helpers/dev-key.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';

// Synthetic channel addresses; a local receiver stands in for Slack and Teams.
const SLACK_A = "https://hooks.slack.com/services/synthetic-lamp-1/synthetic-lamp-2/synthetic-lamp-3";
const SLACK_B = "https://hooks.slack.com/services/synthetic-lamp-4/synthetic-lamp-5/synthetic-lamp-6";
const TEAMS = "https://prod-00.westus.logic.azure.com:443/workflows/synthetic-lamp-7/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=synthetic-lamp-8";
let cookie;
let runtime;
let receiver;
let database;
const received = [];
const chatSigningSecret = randomBytes(32).toString('hex');
let slackReply = { status: 200, body: "ok" };

async function api(path, init = {}) {
  init = await withDraftVersion(path, init, (readPath) => nativeRequest(readPath, { cookie }));
  const response = await nativeRequest(path, { cookie, ...init, headers: requestHeaders(init.body ? { "Content-Type": "application/json" } : {}, init.headers) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}
const post = (path, json) => api(path, { method: "POST", body: JSON.stringify(json) });
// Read the exact persisted D1; all product mutations remain ordinary HTTP.
const sql = command => database.prepare(command).all().map(row => ({ ...row }));
async function openFixtureDatabase(directory) {
  const candidates = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') {
        const db = new DatabaseSync(name, { readOnly: true });
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='components'").get()) candidates.push(db);
        else db.close();
      }
    }
  }
  await visit(directory);
  if (candidates.length !== 1) {
    for (const db of candidates) db.close();
    throw new Error('Could not identify the migrated channel-journey D1 database.');
  }
  database = candidates[0]; database.exec('PRAGMA busy_timeout=5000;');
}
async function component(name) { return (await post("/api/app/components", { groupId: null, name, description: "", internal: false, displayOrder: 0, note: "" })).body.component; }
async function settle() { for (let round = 0; round < 40; round += 1) { await new Promise((resolve) => setTimeout(resolve, 250)); if (sql("SELECT count(*) AS n FROM channel_posts p LEFT JOIN integration_deliveries x ON x.id = p.id WHERE x.state IS NULL OR x.state IN ('queued','sending')")[0].n === 0) return; } }

/** Isolated migrated Worker: real publication/storage/delivery, with only the
 * provider HTTP edges replaced. A temporary SQL trigger interrupts the second
 * chat insert, after the update and first post have entered the D1 batch. */
async function channelPublicationFlow(t) {
  const requests = [];
  const fixture = await openFollowUpsRuntime({ providerEdge: async request => {
    if (![SLACK_A, SLACK_B, new URL(TEAMS).href].includes(request.url)) return;
    assert.equal(request.method, "POST");
    requests.push({ url: request.url, body: await request.text() });
    return new URL(request.url).hostname === "hooks.slack.com" ? new Response("ok") : new Response(null, { status: 202 });
  } });
  const { api, post, db } = fixture;
  const rows = async query => (await db.prepare(query).all()).results;
  const updates = () => rows("SELECT * FROM incident_updates ORDER BY id");
  const posts = () => rows("SELECT * FROM delivery_channel_posts ORDER BY id");
  const tick = async () => assert.equal((await (await fixture.runtime.getWorker()).scheduled({ cron: "* * * * *", scheduledTime: Date.now() })).outcome, "ok");
  const readIncident = async id => {
    const result = await api(`/api/app/incidents/${id}`);
    assert.equal(result.status, 200, result.text);
    return result.body.incident;
  };
  const save = async (id, details) => {
    const result = await api(`/api/app/incidents/${id}/draft`, { method: "PUT", body: JSON.stringify({ lifecycle: "Investigating", affectedAudience: "Payment customers", customerImpact: "Card payments are delayed", whatStillWorks: "Existing subscriptions", details, nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() }) });
    assert.equal(result.status, 200, result.text);
  };
  const accepted = async expected => {
    await tick();
    await eventuallyFollowUp(() => rows("SELECT id, state FROM integration_deliveries WHERE namespace='lamp-channels' ORDER BY id"), entries => entries.length === expected && entries.every(row => row.state === "accepted"), "every committed chat post has its provider acceptance");
    assert.equal(requests.length, expected, "each accepted post has exactly one receiver request");
  };
  try {
    const targets = [];
    for (const name of ["Synthetic Lamp payments", "Synthetic Lamp unrelated search"]) {
      const made = await post("/api/app/components", { groupId: null, name, description: "", internal: false, displayOrder: 0, note: "" });
      assert.equal(made.status, 201, made.text);
      targets.push(made.body.component);
    }
    const destinations = [];
    for (const input of [
      { kind: "slack", name: "Synthetic Lamp payments", url: SLACK_A, componentIds: [targets[0].id] },
      { kind: "teams", name: "Synthetic Lamp all components", url: TEAMS, componentIds: [] },
      { kind: "slack", name: "Synthetic Lamp search only", url: SLACK_B, componentIds: [targets[1].id] },
    ]) {
      const made = await post("/api/app/channels", input);
      assert.equal(made.status, 201, made.text);
      destinations.push(made.body.channel);
    }
    const made = await post("/api/app/incidents", { title: "Synthetic Lamp atomic channel publication", components: [{ componentId: targets[0].id, state: "Partially unavailable", relationship: "Primary" }] });
    assert.equal(made.status, 201, made.text);
    const id = made.body.incident.id;
    const path = `/api/app/incidents/${id}/publish`;
    // A real earlier publication makes both complete inventory comparisons nonempty.
    await save(id, "Synthetic Lamp original publication");
    const first = await post(path, { channels: ["chat"] });
    assert.equal(first.status, 200, first.text);
    await accepted(2);

    await save(id, "Synthetic Lamp interrupted publication");
    const reviewed = await readIncident(id);
    const original = { method: "POST", body: JSON.stringify({ channels: ["chat"] }), headers: { "If-Match": `${reviewed.draft.id}:${reviewed.updates.length}` } };
    const beforeUpdates = await updates(), beforePosts = await posts(), beforeRequests = [...requests];
    assert.equal(beforeUpdates.length, 1);
    assert.equal(beforePosts.length, 2);
    await db.prepare(`CREATE TRIGGER synthetic_channel_publication_fault BEFORE INSERT ON channel_posts
      WHEN NEW.incident_update_id = '${reviewed.draft.id}' AND EXISTS (SELECT 1 FROM channel_posts WHERE incident_update_id = NEW.incident_update_id)
      BEGIN SELECT RAISE(ABORT, 'Synthetic Lamp channel publication interruption'); END`).run();
    try {
      const refused = await api(path, original);
      assert.equal(refused.status, 409, refused.text);
      assert.match(refused.body.error, /Synthetic Lamp channel publication interruption/);
      await tick();
      assert.deepEqual(await updates(), beforeUpdates, "a post failure rolls back the complete update inventory");
      assert.deepEqual(await posts(), beforePosts, "a post failure rolls back the complete post inventory, including the earlier insert");
      const unchanged = await readIncident(id);
      assert.deepEqual(unchanged.updates, reviewed.updates, "the operator sees no partial publication");
      assert.deepEqual(unchanged.draft, reviewed.draft, "the same saved draft remains available to retry");
      assert.deepEqual(requests, beforeRequests, "the failed transaction reaches no receiver, including on a scheduled pass");
    } finally { await db.prepare("DROP TRIGGER synthetic_channel_publication_fault").run(); }

    const published = await api(path, original);
    assert.equal(published.status, 200, published.text);
    assert.equal(published.body.update.id, reviewed.draft.id);
    const committedPosts = await posts();
    assert.deepEqual(committedPosts.filter(row => row.incident_update_id !== reviewed.draft.id), beforePosts, "publication preserves all earlier post identities");
    assert.deepEqual(committedPosts.filter(row => row.incident_update_id === reviewed.draft.id).map(row => row.destination_id).sort(), destinations.slice(0, 2).map(row => row.id).sort(), "exactly the selected-component Slack and all-visible Teams destinations commit with this update");
    const committedUpdates = await updates();
    assert.deepEqual(committedUpdates.filter(row => row.id !== reviewed.draft.id), beforeUpdates);
    assert.equal(committedUpdates.length, beforeUpdates.length + 1);
    assert.equal((await readIncident(id)).updates.find(row => row.id === reviewed.draft.id).details, reviewed.draft.details);
    await accepted(4);
    assert.deepEqual([SLACK_A, new URL(TEAMS).href, SLACK_B].map(url => requests.filter(row => row.url === url).length), [2, 2, 0], "the unrelated destination remains silent");
    t.diagnostic("PROBE NOTIFY-012 atomic commit: POST /api/app/incidents/:id/publish with chat and a second-post storage fault -> 409; complete inventories stay at 1 update/2 posts, unchanged draft and receivers; retry commits exactly 1 update/2 following posts.");

    const committedRequests = [...requests];
    // Bypass automatic draft-version refresh: these are the original bytes and revision.
    const replayed = await api(path, original);
    assert.equal(replayed.status, 409, replayed.text);
    await tick(); await tick();
    assert.deepEqual(await updates(), committedUpdates, "the original publication request cannot create another update");
    assert.deepEqual(await posts(), committedPosts, "request replay and repeated delivery preserve every post identity");
    assert.deepEqual(requests, committedRequests, "request replay and repeated delivery send no duplicate receiver request");
    t.diagnostic("PROBE NOTIFY-012 original request replay: POST the captured body and If-Match revision, then two scheduled passes -> 409; all 2 update/4 post identities and 4 receiver requests unchanged.");

    await save(id, "Synthetic Lamp distinct backdated publication");
    const retroDraft = (await readIncident(id)).draft;
    const retroactive = await post(path, { channels: ["chat"], publishedAt: first.body.update.publishedAt });
    assert.equal(retroactive.status, 200, retroactive.text);
    assert.equal(retroactive.body.update.id, retroDraft.id);
    assert.notEqual(retroDraft.id, published.body.update.id);
    assert.equal(retroactive.body.update.isRetroactive, true);
    assert.equal(retroactive.body.update.details, retroDraft.details);
    assert.equal((await readIncident(id)).updates.length, committedUpdates.length + 1);
    assert.deepEqual((await updates()).filter(row => row.id !== retroDraft.id), committedUpdates);
    await tick(); await tick();
    assert.deepEqual(await posts(), committedPosts, "a persisted backdated update with chat selected creates no post");
    assert.deepEqual(requests, committedRequests, "the backdated publication and later delivery passes reach no chat receiver");
    t.diagnostic("PROBE NOTIFY-012 retroactive silence: POST a distinct saved draft with chat selected and the earlier publication timestamp -> 200, isRetroactive=true, 3 updates; complete 4-post inventory and 4 receiver requests unchanged.");
  } finally { await fixture.close(); }
}

before(async () => {
  receiver = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received.push({ path: request.url, body });
      // Slack answers "ok"; a Teams Workflows webhook answers 202.
      if (request.url.startsWith("/services/")) response.writeHead(slackReply.status, { "Content-Type": "text/plain" }).end(slackReply.body);
      else response.writeHead(202).end();
    });
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  runtime = await openNativeRuntime();
  runtime.env.LAMP_DEV_CHANNEL_RECEIVER = `http://127.0.0.1:${receiver.address().port}`;
  const configPath = join(runtime.directory, "wrangler.json");
  await writeFile(configPath, localWranglerConfig(config => ({
    ...config, vars: { ...config.vars, WEBHOOK_SIGNING_SECRET: randomBytes(32).toString("hex"), SLACK_SIGNING_SECRET: chatSigningSecret },
  })), { mode: 0o600 });
  runtime.env.LAMP_WRANGLER_CONFIG = configPath;
  await runtime.start();
  await runtime.seedOperator();
  await openFixtureDatabase(runtime.state);
  cookie = (await signInAs({ origin, key: devKey })).header;
  await fetch(`${publicOrigin}/`);
});

after(async () => {
  database?.close();
  await runtime?.close();
  await new Promise((resolve) => receiver?.close(resolve));
});

test("INTEG-002 SUB-014 SUB-015 NOTIFY-011 NOTIFY-012 UPDATE-013 — Private channels deliver the selected publication once with literal text and punctuated links", { timeout: 600_000 }, async t => {
  const api_ = await component("Payments API");

  const created = await post("/api/app/channels", { kind: "slack", name: "#payments", url: SLACK_A, componentIds: [api_.id] });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.channel.host, "hooks.slack.com");
  const slackChannel = created.body.channel;
  const teamsCreated = await post("/api/app/channels", { kind: "teams", name: "Status team", url: TEAMS, componentIds: [] });
  assert.equal(teamsCreated.status, 201, teamsCreated.text);
  const teamsChannel = teamsCreated.body.channel;
  const otherCreated = await post("/api/app/channels", { kind: "slack", name: "#other", url: SLACK_B, componentIds: [(await component("Search")).id] });
  assert.equal(otherCreated.status, 201, otherCreated.text);
  const refusals = [];
  for (const kind of ["slack", "teams"]) {
    const refused = await post("/api/app/channels", { kind, name: "#bad", url: "https://example.com/services/a/b/c", componentIds: [] });
    assert.equal(refused.status, 400, `${kind} refuses a nonprovider host`);
    refusals.push(refused);
  }
  assert.equal(received.length, 0, "saving or refusing a destination sends no webhook request");
  const listed = await api("/api/app/channels");
  const destinations = sql("SELECT * FROM channel_destinations");
  const credentials = [SLACK_A, SLACK_B, TEAMS, new URL(TEAMS).href, ...[SLACK_A, SLACK_B].map(url => new URL(url).pathname), "synthetic-lamp-3", "synthetic-lamp-6", "synthetic-lamp-8"];
  assert.equal(destinations.length, 3, "the refused host creates no destination");
  for (const [channel, kind, host, selectionMode, componentIds] of [
    [slackChannel, "slack", "hooks.slack.com", "selected", [api_.id]],
    [teamsChannel, "teams", "prod-00.westus.logic.azure.com", "all", []],
  ]) {
    const stored = destinations.find(row => row.id === channel.id);
    assert.ok(stored, `${kind} has its own persisted destination`);
    assert.equal(typeof stored.sealed_url, "string");
    assert.ok(stored.sealed_url.length > 0, `${kind} has a nonempty encrypted destination`);
    assert.deepEqual([stored.kind, stored.host, stored.selection_mode], [kind, host, selectionMode]);
    const selections = sql("SELECT destination_id, component_id FROM channel_destination_components").filter(row => row.destination_id === channel.id);
    assert.deepEqual(selections.map(row => row.component_id), componentIds, `${kind} persists its exact component selection`);
    // Separate native GETs prove each saved selection independently of the create response.
    const loaded = await api("/api/app/channels");
    assert.equal(loaded.status, 200, loaded.text);
    const saved = loaded.body.channels.find(row => row.id === channel.id);
    assert.ok(saved, `${kind} survives a fresh Settings read`);
    assert.deepEqual([saved.kind, saved.host, saved.selectionMode, saved.componentIds], [kind, host, selectionMode, componentIds]);
    assertCredentialsHidden(loaded, `${kind} readback`);
    for (const enabled of [true, false]) {
      const patched = await api(`/api/app/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ operatorAlerts: enabled }) });
      assert.equal(patched.status, 200, patched.text);
      assertCredentialsHidden(patched, `${kind} patch`);
      assert.equal((await api("/api/app/channels")).body.channels.find(row => row.id === channel.id).operatorAlerts, enabled);
    }
  }
  function assertCredentialsHidden(response, door) {
    for (const secret of [...credentials, ...destinations.map(row => row.sealed_url)]) {
      assert.ok(!response.text.includes(secret), `${door} never exposes a webhook credential or sealed ciphertext`);
    }
    assert.doesNotMatch(response.text, /"(?:sealedUrl|sealed_url)"\s*:/, `${door} omits sealed destination fields`);
  }
  for (const [door, response] of [["Slack create", created], ["Teams create", teamsCreated], ["other create", otherCreated], ["list", listed], ...refusals.map(response => ["host refusal", response])]) assertCredentialsHidden(response, door);
  for (const secret of credentials) {
    assert.ok(!listed.text.includes(secret), "listed channels hide webhook credentials");
    assert.ok(!JSON.stringify(destinations).includes(secret), "only ciphertext is stored");
    assert.ok(!runtime.output.includes(secret), "never logged");
  }
  const [payments] = (await api("/api/app/components")).body.components.filter((row) => row.name === "Payments API");
  const incident = await post("/api/app/incidents", { title: "Card payments failing", components: [{ componentId: payments.id, state: "Partially unavailable", relationship: "Primary" }] });
  assert.equal(incident.status, 201, incident.text);
  const id = incident.body.incident.id;
  const draft = { lifecycle: "Investigating", ...UPDATE_LINK_FIELDS, details: `${UPDATE_LINK_FIELDS.details} See https://help.example.com/kb/123.`, nextUpdateAt: new Date(Date.now() + 3_600_000).toISOString() };
  assert.equal((await api(`/api/app/incidents/${id}/draft`, { method: "PUT", body: JSON.stringify(draft) })).status, 200);
  assert.equal((await api(`/api/app/incidents/${id}/impact`, { method: "PUT", body: JSON.stringify({ impactOverride: "major" }) })).status, 200);
  const published = await post(`/api/app/incidents/${id}/publish`, { channels: ["chat"] });
  assert.equal(published.status, 200, published.text);
  assert.equal((await api(`/api/app/incidents/${id}/impact`, { method: "PUT", body: JSON.stringify({ impactOverride: null }) })).status, 200);
  await settle();
  // A second scheduled pass finds nothing new to send.
  await fetch(`${publicOrigin.replace("localhost", "127.0.0.1")}/cdn-cgi/handler/scheduled`);
  await settle();
  const slack = received.filter((entry) => entry.path === new URL(SLACK_A).pathname);
  const teams = received.filter((entry) => entry.path === `${new URL(TEAMS).pathname}${new URL(TEAMS).search}`);
  assert.equal(slack.length, 1);
  assert.equal(teams.length, 1);
  assert.deepEqual(sql("SELECT destination_id FROM channel_posts ORDER BY destination_id").map(row => row.destination_id), [slackChannel.id, teamsChannel.id].sort(), "the saved destinations receive the selected publication");
  assert.equal(received.filter((entry) => entry.path === new URL(SLACK_B).pathname).length, 0, "a channel for another component receives nothing");
  assert.match(JSON.parse(slack[0].body).text, /INC-\d+ Investigating: Card payments failing/);
  assert.equal(JSON.parse(teams[0].body).attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
  const slackMessage = JSON.parse(slack[0].body);
  assert.match(slackMessage.text, /Incident impact: Major/);
  assert.deepEqual(sql("SELECT incident_impact AS impact FROM channel_posts").map(row => row.impact), ["major", "major"], "committed channel impact survives a later clear");
  assertLinkedSlackText(slackMessage.text, "Slack channel post");
  const elements = slackMessage.blocks.flatMap(block => block.elements.flatMap(section => section.elements));
  assert.ok(elements.some(element => element.type === "link" && element.url === LINKED_URL && element.text === LINKED_URL));
  assert.ok(elements.some(element => element.type === "text" && element.text.includes('Literal <a href="https://x.test">x</a>, **markdown**, javascript:alert(1), http://example.com/x and data:text/html,x')));
  assert.ok(!elements.some(element => element.type === "link" && (element.text !== element.url || /x\.test|^http:|^javascript:|^data:/.test(element.url))));
  for (const field of Object.values(UPDATE_LINK_FIELDS)) assert.ok(elements.map(element => element.text).join("").includes(field), "Slack rich text keeps each field unchanged");
  // Adaptive Card TextBlock Markdown: each link's visible text is its own URL, punctuation stays outside.
  const teamsBody = JSON.parse(teams[0].body).attachments[0].content.body.map(block => block.text).join("\n");
  const teamsLink = url => `[${url.replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&")}](${url})`;
  assert.ok(teamsBody.includes(`See ${teamsLink(LINKED_URL)}\\.`), "Teams links the named URL with the period outside");
  assert.ok(teamsBody.includes(`at ${teamsLink(LINKED_URL)}, and the guide \\(${teamsLink(LINKED_URL)}\\) explains`), "Teams keeps a comma and a closing parenthesis outside the link");
  for (const [, label, url] of teamsBody.matchAll(/\[((?:\\.|[^\]\\])*)\]\(([^)]*)\)/g)) {
    assert.equal(label.replace(/\\(.)/g, "$1"), url, "every Teams link shows its own URL");
    assert.match(url, /^https:\/\//, "only bare HTTPS URLs become Teams links");
  }
  assert.doesNotMatch(teamsBody, /\]\((?:javascript:|http:|data:|https:\/\/x\.test)/);
  assert.ok(teamsBody.includes("\\*\\*markdown\\*\\*"), "Teams keeps author markup literal");
  assert.ok(teamsBody.includes("javascript:alert\\(1\\)") && teamsBody.includes("data:text/html,x"), "Teams keeps other schemes literal");
  assert.match(teams[0].path, /sig=synthetic-lamp-8/, "Teams keeps its signed query");
  assert.ok(teamsBody.includes("http://example\\.com/x"), "Teams keeps the HTTP scheme as literal text");
  assert.ok(teamsBody.includes('&lt;a href=&quot;https://x\\.test&quot;&gt;x&lt;/a&gt;'), "Teams retains HTML markup as escaped literal text");
  const teamsDetails = JSON.parse(teams[0].body).attachments[0].content.body.find(block => block.text.startsWith("Additional details: ")).text;
  assert.ok(teamsDetails.includes("http://example\\.com/x"), "Teams keeps the HTTP scheme as literal text");
  assert.ok(teamsDetails.includes('&lt;a href=&quot;https://x\\.test&quot;&gt;x&lt;/a&gt;'), "Teams retains HTML markup as escaped literal text");
  assert.deepEqual(sql("SELECT state FROM integration_deliveries ORDER BY state").map((row) => row.state), ["accepted", "accepted"]);
  assertCredentialsHidden(await api("/api/app/channels"), "list with publication log");
  for (const reply of [
    { status: 200, body: "invalid_payload" },
    { status: 400, body: "channel_is_archived" },
    { status: 200, body: "" },
    { status: 200, body: "not ok" },
    { status: 400, body: `invalid_payload: ${SLACK_A}` },
    { status: 200, body: "ok" },
  ]) {
    slackReply = reply;
    const result = await post(`/api/app/channels/${slackChannel.id}/test`, {});
    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.sent, reply.body === "ok", `Slack HTTP ${reply.status}: ${reply.body || "empty response"}`);
    if (reply.body && reply.body !== "ok") assert.ok(result.body.message.includes(reply.body.replaceAll(SLACK_A, "[webhook URL]")), "show Slack's rejection text without the webhook credential");
    assertCredentialsHidden(result, "Slack test result");
    assert.match(JSON.parse(received.at(-1).body).text, /Test post from Lamp/);
  }
  const teamsTest = await post(`/api/app/channels/${teamsChannel.id}/test`, {});
  assert.equal(teamsTest.status, 200, teamsTest.text);
  assert.equal(teamsTest.body.sent, true, "Teams accepts an empty HTTP 202 response");
  assertCredentialsHidden(teamsTest, "Teams test result");
  assert.equal(sql("SELECT count(*) AS n FROM integration_deliveries")[0].n, 2, "test posts stay outside the durable publication log");
  await channelsBrowserFlow({ origin, devLink: async () => `${origin}/__dev/key#${new URLSearchParams({ 'rer-dev': devKey, as: 'owner' })}`, channels: [slackChannel, teamsChannel], componentName: api_.name, secrets: [...credentials, ...destinations.map(row => row.sealed_url)] });
  for (const channel of [slackChannel, teamsChannel]) {
    const removed = await api(`/api/app/channels/${channel.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200, removed.text);
    assertCredentialsHidden(removed, "removal");
    const remaining = await api("/api/app/channels");
    assert.ok(!remaining.body.channels.some(row => row.id === channel.id), "removed destination stays absent from fresh reads");
    assertCredentialsHidden(remaining, "list after removal");
    const afterRemoval = await post(`/api/app/channels/${channel.id}/test`, {});
    assert.equal(afterRemoval.status, 404, afterRemoval.text);
    assertCredentialsHidden(afterRemoval, "test after removal");
  }
  for (const secret of [...credentials, ...destinations.map(row => row.sealed_url)]) assert.ok(!runtime.output.includes(secret), "channel operations never log webhook credentials or ciphertext");
  await channelDeletionFlow({ api, post, origin, nativeRequest, runtime });
  await socialBrowserFlow({ origin, devLink: async () => `${origin}/__dev/key#${new URLSearchParams({ 'rer-dev': devKey, as: 'owner' })}`, diagnostic: text => t.diagnostic(text) });
  await runtime.stop();
  try { await channelPublicationFlow(t); await selfServeChatFlow(t); await socialPostsFlow(t); } finally { await runtime.start(); }
});



const payloads = {
  datadog: { down: { alert_id: "1234", alert_cycle_key: "cycle-1", alert_transition: "Triggered", alert_title: "[Triggered] Checkout latency", event_title: "Checkout latency" }, up: { alert_id: "1234", alert_cycle_key: "cycle-1", alert_transition: "Recovered", alert_title: "[Recovered] Checkout latency" } },
  uptimerobot: { down: { monitorID: "778", monitorURL: "https://shop.example.com", monitorFriendlyName: "Shop", alertType: "1", alertTypeFriendlyName: "Down", alertDetails: "Connection timeout", alertDateTime: "1791700000" }, up: { monitorID: "778", monitorFriendlyName: "Shop", alertType: "2", alertTypeFriendlyName: "Up", alertDuration: "120" } },
  betterstack: { down: { data: { id: "25", type: "incident", attributes: { name: "shop homepage", url: "https://shop.example.com/", cause: "Status 503", started_at: "2026-10-11T05:00:00.000Z", resolved_at: null, status: "Started" }, relationships: { monitor: { data: { id: "2", type: "monitor" } } } } }, up: { data: { id: "25", type: "incident", attributes: { name: "shop homepage", cause: "Status 503", resolved_at: "2026-10-11T05:05:00.000Z", status: "Resolved" } } } },
  pingdom: { down: { check_id: 12345, check_name: "Shop HTTP", check_type: "HTTP", previous_state: "UP", current_state: "DOWN", state_changed_timestamp: 1791700000, description: "Timeout" }, up: { check_id: 12345, check_name: "Shop HTTP", check_type: "HTTP", previous_state: "DOWN", current_state: "UP", description: "OK" } },
};
const sources = {};

test("AUTO-001 INTAKE-014 INTAKE-011 INTAKE-016 INTAKE-010 INTAKE-009 INTAKE-008 INTAKE-005 INTAKE-006 INTAKE-007 UPTIME-008 UPTIME-009 — Connect monitors, review private alert drafts, publish and recover with durable integration evidence", { timeout: 600_000 }, async t => {
  await uptimePairingFlow({ api, component, origin, cookie });
  for (const preset of Object.keys(payloads)) {
    const target = await component(`Shop (${preset})`);
    const created = await post("/api/app/intake/sources", { name: `${preset} preset`, preset, componentId: target.id, credentialKind: "bearer-token" });
    assert.equal(created.status, 201, created.text);
    const { id, token, endpointUrl } = created.body.source;
    assert.match(token, /.{20,}/);
    sources[preset] = { id, token, endpointUrl, component: target };
    const listed = await api("/api/app/intake/sources");
    assert.doesNotMatch(listed.text, new RegExp(token), "the token is shown once");
    const send = (body, init = {}) => fetch(init.path ?? endpointUrl, { method: "POST", headers: { "Content-Type": "application/json", ...init.headers }, body: JSON.stringify(body) });
    assert.equal((await send(payloads[preset].down)).status, 401, `${preset}: no credential`);
    assert.equal((await send(payloads[preset].down, { headers: { Authorization: "Bearer wrong-token-wrong-token" } })).status, 401, `${preset}: wrong credential`);
    const other = Object.keys(payloads).find((candidate) => candidate !== preset);
    assert.equal((await send(payloads[other].down, { headers: { Authorization: `Bearer ${token}` } })).status, 400, `${preset}: another tool's payload`);
    // Header for tools that send one, path segment for those that cannot.
    const accepted = await send(payloads[preset].down, preset === "datadog" || preset === "uptimerobot" ? { headers: { Authorization: `Bearer ${token}` } } : { path: `${endpointUrl}/${token}` });
    assert.equal(accepted.status, 202, `${preset}: documented alert`);
    const firing = await accepted.json();
    const incident = (await api(`/api/app/incidents/${firing.incidentId}`)).body.incident;
    Object.assign(sources[preset], { firing, incident });
    assert.equal(incident.updates.length, 0, "never published");
    assert.deepEqual(incident.components.map((row) => row.componentId), [target.id]);
    assert.equal(incident.components[0].publishedAt ?? null, null);
  }
  const receipts = (await api("/api/app/intake/receipts")).body.receipts;
  assert.equal(receipts.filter((receipt) => receipt.state === "invalid").length, 4, "refused payloads are recorded against their source");
  const page = await (await fetch(`${publicOrigin}/api/public/status`)).text();
  assert.doesNotMatch(page, /Checkout latency|Shop \(/, "no public surface changes");
  await presetRecoveryFlow({ api, post, runtime, publicOrigin, sql, sources, payloads, t });
  await uptimePresetFlow({ api, post, component, publicOrigin });
  await groupedAlertsFlow({ api, post, component, sql, origin, publicOrigin, cookie });
  await monitorSetupJourney({ api, component, origin, publicOrigin, cookie });
  await metricSetupJourney({ api, post, component, origin, cookie });
  // Isolate this browser journey from accumulated development replay state.
  // Restart only the transport; keep the database, owner session and
  // source records that the automation assertions read back.
  await runtime.stop();
  await runtime.start();
  await automationRulesBrowserFlow({ origin, publicOrigin, cookie, component, api, post });
  await pagerDutyFlow({ runtime, t });
  await operationsAlertsFlow({ t });
  await automationRulesFlow({ t });
  await automationFlapFlow({ t });
  await metricsFlow({ t });
});
