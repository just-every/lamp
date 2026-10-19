import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before } from "node:test";

import { continuityFiles, assertContinuityCounts, postmortemTemplateImportFlow } from "./helpers/postmortem-template-import-flow.mjs";

import { contract } from "../contract.mjs";

// Wrangler CLI work between requests can outlast an idle keep-alive socket; every request opens its own connection.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const request = new Request(input, init); request.headers.set("connection", "close"); return nativeFetch(request, { referrer: request.referrer, referrerPolicy: request.referrerPolicy }); };
import { nativeRequest, openNativeRuntime, publicOrigin, origin, operator } from "../dev-ingress/runtime.mjs";
import { devKey } from '../helpers/dev-key.mjs';
import { signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { notificationActivity, assertNoNewNotifications, sendImportedInvitations, moveInDoor } from '../helpers/import-notifications.mjs';

// Synthetic saved responses shaped like Statuspage's public API (no real account).
const fixtures = (family) => readdirSync(join("tests/fixtures/statuspage", family)).map((name) => ({ name, text: readFileSync(join("tests/fixtures/statuspage", family, name), "utf8") }));
let cookie;
const API_KEY = "synthetic-statuspage-key-0001";
let runtime;
let statuspage;
let statuspageRequests = [];
let aliasBefore;
let editedIncident;
let editedMaintenance;
const sourceRows = (family) => fixtures(family).filter((file) => file.name.startsWith("incidents")).flatMap((file) => JSON.parse(file.text));
async function aliasesFor(records) {
  const result = {};
  for (const row of records) {
    for (const path of [`/incidents/${row.id}`, new URL(row.shortlink).pathname]) {
      const response = await fetch(`${publicOrigin}${path}`, { redirect: "manual" });
      result[path] = { status: response.status, location: response.headers.get("Location") };
    }
  }
  return result;
}

async function api(path, json, headers) {
  const response = await nativeRequest(path, { cookie, ...(json ? { method: "POST", json } : {}), ...(headers ? { headers } : {}) });
  return { status: response.status, body: await response.json() };
}
const moveIn = moveInDoor(api);
async function counts() {
  const [components, incidents, maintenance, subscribers] = await Promise.all(["/api/app/components", "/api/app/incidents", "/api/app/maintenance", "/api/app/subscribers?limit=100"].map((path) => api(path)));
  return { components: components.body.components.length, groups: components.body.groups.length, incidents: incidents.body.incidents.length, maintenance: maintenance.body.maintenance.length, subscribers: subscribers.body.subscribers.length };
}
const deliveries = async () => (await api("/api/app/deliveries?limit=100")).body.deliveries.length;
/** Apply, then continue until every import batch is done, as the wizard does. */
async function importAll(files) {
  const preview = await moveIn.preview({ files });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const result = await moveIn.apply(preview.body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.job.state, "completed");
  return { preview: preview.body, result: result.body };
}

before(async () => {
  statuspage = createServer((request, response) => {
    statuspageRequests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    if (request.headers.authorization === `OAuth ${API_KEY}` && request.url === '/v1/pages/synthpage01') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(fixtures('small').find(file => file.name === 'page.json').text); return;
    }
    if (request.headers.authorization === `OAuth ${API_KEY}` && request.url === '/v1/pages/synthpage01/page_access_groups') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('[]'); return;
    }
    const match = /^\/v1\/pages\/synthpage01\/([a-z/_-]+)\?/u.exec(request.url ?? "");
    if (request.headers.authorization !== `OAuth ${API_KEY}`) { response.writeHead(401).end("{}"); return; }
    const resource = match?.[1].replace("/", "-").replaceAll("_", "-");
    const page = Number(new URL(request.url, "http://x").searchParams.get("page"));
    const name = page === 1 ? `${resource}.json` : `${resource}-${page}.json`;
    const file = continuityFiles(fixtures("small")).find((candidate) => candidate.name === name);
    response.writeHead(200, { "Content-Type": "application/json" }).end(file?.text ?? "[]");
  });
  await new Promise((resolve) => statuspage.listen(0, "127.0.0.1", resolve));
  runtime = await openNativeRuntime();
  runtime.env.LAMP_DEV_STATUSPAGE_ORIGIN = `http://127.0.0.1:${statuspage.address().port}`;
  await runtime.start();
  await runtime.seedOperator();
  cookie = (await signInAs({ origin, key: devKey })).header;
  await fetch(`${publicOrigin}/`);
});

after(async () => {
  await runtime?.close();
  await new Promise((resolve) => statuspage?.close(resolve));
});

contract("MOVE-001", "MOVE-011 — a dry run reports every record and writes nothing; the API-key path reads Statuspage with GET only; postmortems and templates dry-run, apply silently, repeat and undo", async () => {
  const before = await counts();
  const unauthenticated = await nativeRequest("/api/operator/import/uploads", { method: "POST", json: {}, headers: { "X-Import-Source": "statuspage" } });
  assert.equal(unauthenticated.status, 401);
  const preview = await moveIn.preview({ pageId: "synthpage01", apiKey: API_KEY });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(Object.fromEntries(Object.entries(preview.body.report.counts).map(([kind, count]) => [kind, count.imported + count.changed])), { group: 0, component: 2, incident: 2, maintenance: 0, subscriber: 2, template: 3, postmortem: 1 });
  assertContinuityCounts(preview.body.report);
  assert.ok(statuspageRequests.length >= 6 && statuspageRequests.every((request) => request.method === "GET" && request.authorization === `OAuth ${API_KEY}`));
  // The fetched responses come back to the owner as saved responses; the key does not.
  assert.deepEqual(preview.body.files.map((file) => file.name).sort(), ["component-groups.json", "components.json", "incident-templates.json", "incidents-scheduled.json", "incidents.json", "page-access-groups.json", "page.json", "subscribers.json"]);
  assert.doesNotMatch(JSON.stringify(preview.body), new RegExp(API_KEY));
  const refusedKey = await moveIn.preview({ pageId: "synthpage01", apiKey: "wrong-key-wrong-key-0001" });
  assert.equal(refusedKey.status, 400);
  for (const address of ["https://stspg.io/app/settings", "//evil.example/x", "https://stspg.io/incidents/INC-1", "https://stspg.io/a%2fb", "https://stspg.io/feed.atom", "javascript:alert(1)"]) {
    const files = fixtures("small");
    const incidents = files.find((file) => file.name === "incidents.json");
    const rows = JSON.parse(incidents.text); rows[0].shortlink = address; incidents.text = JSON.stringify(rows);
    const refused = await moveIn.preview({ files });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(JSON.stringify(refused.body), /shortlink|public address/u);
  }
  const conflictFiles = fixtures("small");
  const incidentFile = conflictFiles.find((file) => file.name === "incidents.json");
  const conflictRows = JSON.parse(incidentFile.text); conflictRows[1].shortlink = conflictRows[0].shortlink; incidentFile.text = JSON.stringify(conflictRows);
  const conflict = await moveIn.preview({ files: conflictFiles });
  assert.equal(conflict.status, 400); assert.match(JSON.stringify(conflict.body), /conflicts/u);
  assert.deepEqual(await counts(), before);
  const stale = await moveIn.apply(preview.body, "0".repeat(64));
  assert.equal(stale.status, 409); assert.equal(stale.body.error, "The source or this page changed since the dry run. Review a fresh dry run.");
  assert.deepEqual(await counts(), before);
  const mailBefore = await notificationActivity(runtime);
  await postmortemTemplateImportFlow({ api, request: (path, init) => nativeRequest(path, { cookie, ...init }), importAll, moveIn, original: fixtures("small"), publicOrigin });
  assert.deepEqual(await counts(), before, "complete undo removes both reports and all three templates");
  await assertNoNewNotifications(runtime, mailBefore, "postmortem/template preview, apply, repeat and undo send nothing");
});

contract("MOVE-002", "an import is retroactive: history keeps its times, nobody is notified of it, and subscribers are invited only by the owner", async t => {
  const before = await counts();
  const mailBefore = await notificationActivity(runtime);
  const files = fixtures("large");
  const componentFile = files.find(file => file.name === "components.json");
  const sourceComponents = JSON.parse(componentFile.text);
  const { preview, result } = await importAll(files);
  const expected = { group: [3, 0, 0], component: [13, 0, 0], incident: [84, 6, 2], maintenance: [3, 1, 0], subscriber: [6, 0, 0] };
  for (const [kind, [imported, changed, rejected]] of Object.entries(expected)) {
    assert.deepEqual([preview.report.counts[kind].imported, preview.report.counts[kind].changed, preview.report.counts[kind].rejected], [imported, changed, rejected], kind);
  }
  assert.equal(preview.report.counts.subscriber.skipped, 5);
  assert.deepEqual(result.report.counts, preview.report.counts);
  assert.deepEqual(await counts(), { components: before.components + 13, groups: before.groups + 3, incidents: before.incidents + 90, maintenance: before.maintenance + 4, subscribers: before.subscribers + 6 });

  const incidents = (await api("/api/app/incidents")).body.incidents;
  const first = incidents.find((incident) => incident.title === "Incident 1 on Service 1.2");
  assert.equal(first.updates.length, 4);
  assert.equal(first.updates.at(-1).publishedAt, "2026-01-04T08:00:00.000Z");
  assert.ok(first.updates.every((update) => update.isRetroactive));
  const component = (await api("/api/app/components")).body.components.find((row) => row.name === "Service 1.2");
  const importedConditional = (await api("/api/app/components")).body.components.find(row => row.name === sourceComponents.find(row => row.only_show_if_degraded).name);
  assert.equal(importedConditional.onlyShowIfDegraded, true, "Statuspage conditional visibility survives the native import");
  const history = (await api(`/api/app/components/${component.id}/history`)).body;
  assert.ok(JSON.stringify(history).includes("2026-01-04T08:00:00.000Z"), "uptime history carries the source time");
  const maintenance = (await api("/api/app/maintenance")).body.maintenance;
  assert.deepEqual(maintenance.map((window) => window.state).sort(), ["Completed", "Completed", "In progress", "Scheduled"]);
  assert.ok(maintenance.every((window) => window.notices.length === 0), "no maintenance notice is published for imported windows");

  assert.equal(await deliveries(), 0, "no notification is queued for imported history");
  await assertNoNewNotifications(runtime, mailBefore, "import and resume send no mail");
  await api(`/api/app/statuspage-import/jobs/${result.job.id}`);
  await api('/api/app/statuspage-import/jobs');
  await assertNoNewNotifications(runtime, mailBefore, "preview reads send no mail");
  const { invited, messages: mail } = await sendImportedInvitations(t, runtime, { origin, publicOrigin, operator, jobId: result.job.id });
  assert.equal(invited.status, 200, JSON.stringify(invited.body));
  assert.equal(invited.body.invites.remaining, 0);
  assert.equal(mail.length, 6);
  assert.deepEqual(new Set(mail.map((envelope) => envelope.message.to)).size, 6);
  const pageName = (await api("/api/app/page-settings")).body.settings.pageName;
  assert.ok(mail.every((envelope) => envelope.message.subject.includes(pageName)), "invitations identify the configured business");
  assert.ok(mail.every((envelope) => /https?:\/\/\S+\/confirm-subscription\/\S+/u.test(envelope.message.text) && !/Incident \d/u.test(envelope.message.text)), "only confirmation invitations are sent, never imported history");
  const subscribers = (await api("/api/app/subscribers?limit=100")).body.subscribers;
  assert.ok(subscribers.every((subscriber) => subscriber.state === "pending"));
  // The invitation is an ordinary confirmation: following it activates that subscriber.
  const link = mail[0].message.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/u)[0];
  const page = await fetch(link);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Subscription confirmed/u);
  const confirmed = (await api("/api/app/subscribers?limit=100")).body.subscribers.filter((subscriber) => subscriber.state === "active");
  assert.deepEqual(confirmed.map((subscriber) => subscriber.destination), [mail[0].message.to]);
});

contract("MOVE-005", "imported incident and maintenance bookmarks reach permanent public records and old Atom serves the native feed", async () => {
  const records = sourceRows("large");
  const incidents = (await api("/api/app/incidents")).body.incidents;
  const maintenance = (await api("/api/app/maintenance")).body.maintenance;
  const targets = [...incidents.map((row) => ({ ...row, path: `/incidents/${row.reference}` })), ...maintenance.map((row) => ({ ...row, path: `/maintenance/${row.reference}` }))];
  const imported = records.filter((row) => targets.some((target) => target.title === row.name));
  aliasBefore = await aliasesFor(imported);
  for (const row of imported) {
    const target = targets.find((target) => target.title === row.name);
    for (const path of [`/incidents/${row.id}`, new URL(row.shortlink).pathname]) {
      assert.deepEqual(aliasBefore[path], { status: 301, location: target.path });
      assert.equal((await fetch(`${origin}${path}`, { redirect: "manual" })).status, 404, "aliases never route on operator host");
    }
    const page = await fetch(`${publicOrigin}${target.path}`);
    assert.equal(page.status, 200); assert.ok((await page.text()).includes(target.title));
  }
  const feed = await fetch(`${publicOrigin}/history.atom`);
  assert.equal(feed.status, 200); assert.match(feed.headers.get("Content-Type"), /application\/atom\+xml/u);
  assert.equal(await feed.text(), await (await fetch(`${publicOrigin}/feed.atom`)).text());
  for (const path of ["/api/v2/summary.json", "/history.rss"]) { const response = await fetch(`${publicOrigin}${path}`); assert.equal(response.status, 200); assert.ok((await response.text()).length > 0); }
  for (const path of ["/auth/login", "/app/settings"]) assert.equal((await fetch(`${publicOrigin}${path}`)).status, 404);
});

contract("MOVE-003", "a second run of the same source changes nothing and sends nothing", async () => {
  const before = await counts();
  const mailBefore = await notificationActivity(runtime);
  const files = fixtures("large");
  const preview = await moveIn.preview({ files });
  assert.equal(preview.body.report.state, "already imported");
  const again = await moveIn.apply(preview.body);
  assert.equal(again.status, 200);
  assert.deepEqual(await counts(), before);
  await assertNoNewNotifications(runtime, mailBefore);
  assert.equal(await deliveries(), 0);
  const reread = await aliasesFor(sourceRows("large").filter((row) => aliasBefore[`/incidents/${row.id}`]));
  assert.deepEqual(reread, aliasBefore, "second apply leaves every alias unchanged");
});

contract("MOVE-004", "MOVE-011 — undo removes what the import created and keeps what an operator changed since, including edited reports and templates", async () => {
  const jobs = (await api("/api/app/statuspage-import/jobs")).body.jobs;
  const job = jobs.find((candidate) => candidate.state === "completed");
  const components = (await api("/api/app/components")).body.components;
  const edited = components.find((row) => row.name === "Service 2.1");
  const patch = await nativeRequest(`/api/app/components/${edited.id}`, { cookie, method: "PUT", json: { groupId: edited.groupId, name: "Service 2.1 (renamed here)", description: edited.description, internal: false, note: edited.note } });
  assert.equal(patch.status, 200, await patch.text());
  editedIncident = (await api("/api/app/incidents")).body.incidents.find((row) => row.title === "Incident 1 on Service 1.2");
  const draftResponse = await nativeRequest(`/api/app/incidents/${editedIncident.id}/draft`, { cookie, method: "PUT", headers: { "If-Match": `-:${editedIncident.updates.length}` }, json: { lifecycle: "Resolved", affectedAudience: "API customers", customerImpact: "Corrected after import", whatStillWorks: "All services are available", details: "Operator reviewed the imported record", nextUpdateAt: null } });
  assert.equal(draftResponse.status, 200, await draftResponse.clone().text());
  const draft = (await draftResponse.json()).draft;
  const published = await nativeRequest(`/api/app/incidents/${editedIncident.id}/publish`, { cookie, method: "POST", headers: { "If-Match": `${draft.id}:${editedIncident.updates.length}` }, json: { channels: [] } });
  assert.equal(published.status, 200, await published.text());
  editedMaintenance = (await api("/api/app/maintenance")).body.maintenance.find((row) => row.state === "Scheduled");
  const cancelled = await api(`/api/app/maintenance/${editedMaintenance.id}/cancel`, {});
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  const mailBefore = await notificationActivity(runtime);
  const undone = await moveIn.undo(job);
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.job.state, "undone");
  const after = await counts();
  assert.equal(after.incidents, 1);
  assert.equal(after.maintenance, 1);
  const preserved = sourceRows("large").filter((row) => [editedIncident.title, editedMaintenance.title].includes(row.name));
  const preservedAliases = await aliasesFor(preserved);
  for (const [path, result] of Object.entries(preservedAliases)) assert.deepEqual(result, aliasBefore[path], "edited record keeps its original alias");
  const preservedIds = new Set(preserved.map((row) => row.id));
  const removed = sourceRows("large").filter((row) => aliasBefore[`/incidents/${row.id}`] && !preservedIds.has(row.id));
  for (const result of Object.values(await aliasesFor(removed))) assert.equal(result.status, 404, "untouched records lose their aliases");
  assert.ok(undone.body.undo, "undo explains records that stayed");
  assert.ok(undone.body.undo.dispositions.some((item) => item.targetKind === "incident" && item.disposition === "retained"));
  assert.ok(undone.body.undo.dispositions.some((item) => item.targetKind === "maintenance" && item.disposition === "retained"));
  // What an operator or a subscriber changed stays, with what it still needs: the
  // confirmed subscriber, the renamed component, the components that subscriber
  // selected, and their groups. Everything else the import made is gone.
  const kept = (await api("/api/app/subscribers?limit=100")).body.subscribers;
  assert.deepEqual(kept.map((subscriber) => subscriber.state), ["active"]);
  const selected = new Set(kept[0].componentSelections.map((selection) => selection.componentId));
  const remaining = (await api("/api/app/components")).body.components;
  assert.ok(remaining.some((row) => row.name === "Service 2.1 (renamed here)"));
  const keptComponentIds = new Set([...selected, ...editedIncident.components.map((row) => row.componentId), ...editedMaintenance.components.map((row) => row.componentId)]);
  assert.ok(remaining.every((row) => row.name === "Service 2.1 (renamed here)" || keptComponentIds.has(row.id)));
  assert.equal(after.groups, new Set(remaining.map((row) => row.groupId)).size);
  await assertNoNewNotifications(runtime, mailBefore, "undo sends nothing");

  // The small family then lands with its own counts beside what stayed.
  const independentSmall = fixtures("small").map((file) => ({ ...file, text: file.text.replaceAll("i000000000", "small00000").replaceAll("c000000000", "smallcomp0").replaceAll("https://stspg.io/", "https://stspg.io/small-") }));
  await importAll(independentSmall);
  assert.deepEqual(await counts(), { ...after, components: after.components + 2, incidents: after.incidents + 2, subscribers: after.subscribers + 2 });
  const continuityMailBefore = await notificationActivity(runtime);
  await postmortemTemplateImportFlow({ api, request: (path, init) => nativeRequest(path, { cookie, ...init }), importAll, moveIn, original: fixtures("small"), publicOrigin, preserveEdits: true });
  await assertNoNewNotifications(runtime, continuityMailBefore, "edited report/template undo sends nothing");
});
