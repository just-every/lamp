import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { moveInDoor } from "../../helpers/import-notifications.mjs";

const DAY = 86_400_000;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
const regex = value => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const isoDay = instant => new Date(instant).toISOString().slice(0, 10);

function componentInput(component, patch = {}) {
  return { groupId: component.groupId, name: component.name, description: component.description, internal: component.internal, displayOrder: component.displayOrder, note: component.note, onlyShowIfDegraded: component.onlyShowIfDegraded, uptimeStartDate: component.uptimeStartDate, ...patch };
}

function article(html, name) {
  return new RegExp(`<article\\b[^>]*>(?:(?!<article\\b)[\\s\\S])*?<h[1-6]\\b[^>]*>${regex(name)}</h[1-6]>[\\s\\S]*?</article>`, "u").exec(html)?.[0] ?? "";
}

async function ancientSorryFiles(year) {
  const names = ["sorry-status.json", "sorry-components.json", "sorry-notices.json", "sorry-notice-100.json", "sorry-notice-101.json"];
  return Promise.all(names.map(async name => {
    const original = await readFile(new URL(`../../fixtures/sorry/public/${name}`, import.meta.url), "utf8");
    const dated = (text, date) => text.replaceAll("2025-04-02", date);
    if (name === "sorry-notices.json") {
      const body = JSON.parse(original);
      body.notices = body.notices.map(notice => JSON.parse(dated(JSON.stringify(notice), notice.id === 100 ? `${year}-02-02` : `${year + 1}-08-02`)));
      return { name, text: JSON.stringify(body) };
    }
    const date = name === "sorry-notice-100.json" ? `${year}-02-02` : name === "sorry-notice-101.json" ? `${year + 1}-08-02` : `${year}-01-01`;
    return { name, text: dated(original, date) };
  }));
}

/** Compose into an existing public-contract test; registers no cases or browser processes. */
export async function catalogueHistoryFlow({ appFetch, fetch, pageUrl, queryLocalSql, executeLocalSql, updateSettings, diagnostic = () => {} }) {
  const prefix = `Catalogue ${randomUUID().slice(0, 8)}`;
  const bulk = "/api/app/components/bulk";
  const moveIn = moveInDoor(async (path, input, headers) => {
    const response = await appFetch(path, { method: input === undefined ? "GET" : "POST", ...(input === undefined ? {} : { body: JSON.stringify(input) }), ...(headers ? { headers } : {}) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  });
  const moved = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
  const newComponents = new Set(), newGroups = new Set();
  let conditionalIncident, boundaryId, originalTimezone;
  const importJobs = [];
  async function api(path, method = "GET", input, status = 200) {
    const response = await appFetch(path, { method, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  const current = () => api(bulk);
  const apply = review => api(`${bulk}/apply`, "POST", { catalogue: review.catalogue, revision: review.revision, reviewToken: review.reviewToken });
  async function read(path, init) {
    const response = await fetch(`${pageUrl}${path}`, init);
    return { status: response.status, body: await response.text(), version: response.headers.get("X-Lamp-Snapshot-Version"), location: response.headers.get("Location") };
  }
  async function published(description, observe, accepts) {
    const start = performance.now();
    let value;
    do {
      value = await observe();
      if (accepts(value)) { diagnostic(`${description}: ${(performance.now() - start).toFixed(0)} ms`); return value; }
      await delay(100);
    } while (performance.now() - start < 10_000);
    assert.fail(`${description} did not reach the public snapshot within 10 seconds: ${JSON.stringify(value).slice(0, 800)}`);
  }
  const ledgerCounts = () => queryLocalSql("SELECT (SELECT count(*) FROM components) AS components,(SELECT count(*) FROM component_groups) AS groups,(SELECT count(*) FROM component_claim_events) AS claims,(SELECT count(*) FROM component_state_history) AS history");
  const settings = (await api("/api/app/page-settings")).settings;
  originalTimezone = settings.timezone;
  try {
    diagnostic("COMP-009 — a 50-component CSV previews without writes, then applies exactly the reviewed catalogue");
    const before = await current(), countsBefore = await ledgerCounts();
    const description = 'Customer details, "quoted"\nLiteral <script>customer text</script> & support. '.padEnd(500, "x");
    const startDate = isoDay(Date.now() - 2 * DAY);
    const names = Array.from({ length: 50 }, (_, index) => `${prefix} service ${String(index + 1).padStart(2, "0")}`);
    const csv = ["name,group,description,display_order,only_show_if_degraded,uptime_start_date", ...names.map((name, index) => [name, `${prefix} group ${index < 25 ? "A" : "B"}`, description, 49 - index, index === 0, index === 1 ? startDate : ""].map(csvCell).join(","))].join("\r\n");
    const review = await api(`${bulk}/preview`, "POST", { csv });
    assert.deepEqual(review.counts.components, { created: 50, changed: 0, deleted: 0 });
    assert.deepEqual(review.counts.groups, { created: 2, changed: 0, deleted: 0 });
    assert.deepEqual(await current(), before, "CSV preview leaves the complete persisted catalogue and revision unchanged");
    assert.deepEqual(await ledgerCounts(), countsBefore, "CSV preview creates no hidden claim or history rows");
    review.catalogue.components.filter(component => !before.catalogue.components.some(old => old.id === component.id)).forEach(component => newComponents.add(component.id));
    review.catalogue.groups.filter(group => !before.catalogue.groups.some(old => old.id === group.id)).forEach(group => newGroups.add(group.id));
    await api(`${bulk}/preview`, "POST", { csv: `name,description\nBad description,${"x".repeat(501)}` }, 400);
    assert.deepEqual(await current(), before, "a refused dry run writes nothing");
    assert.deepEqual(await ledgerCounts(), countsBefore);
    const tampered = structuredClone(review);
    tampered.catalogue.components.find(component => newComponents.has(component.id)).note = "This change was not reviewed.";
    await api(`${bulk}/apply`, "POST", { catalogue: tampered.catalogue, revision: review.revision, reviewToken: review.reviewToken }, 400);
    assert.deepEqual(await current(), before, "apply refuses input changed after preview");
    await apply(review);
    let saved = await current();
    assert.equal(saved.catalogue.components.length, before.catalogue.components.length + 50);
    const conditional = saved.catalogue.components.find(component => component.name === names[0]);
    let uptime = saved.catalogue.components.find(component => component.name === names[1]);
    assert.equal(uptime.description, description);
    assert.equal(uptime.uptimeStartDate, startDate);
    const html = await published("CSV public order and native descriptions", () => read("/"), result => result.status === 200 && result.body.includes(names[24]) && result.body.includes(description.slice(0, 16)));
    assert.ok(html.body.indexOf(names[24]) < html.body.indexOf(names[1]), "CSV positions determine the order within the group");
    assert.match(article(html.body, uptime.name), /<details\b[\s\S]*?<summary>[\s\S]*?<\/summary>[\s\S]*?&lt;script&gt;customer text&lt;\/script&gt;[\s\S]*?<\/details>/u, "plain descriptions use a native disclosure and escape author markup");

    diagnostic("COMP-009 — a stale reviewed table cannot overwrite a concurrent edit");
    const stale = await api(`${bulk}/preview`, "POST", { catalogue: saved.catalogue, revision: saved.revision });
    await api(`/api/app/components/${uptime.id}`, "PUT", componentInput(uptime, { note: "A newer edit must survive." }));
    const afterConcurrentEdit = await current();
    await api(`${bulk}/apply`, "POST", { catalogue: stale.catalogue, revision: stale.revision, reviewToken: stale.reviewToken }, 409);
    assert.deepEqual(await current(), afterConcurrentEdit);
    await api(`${bulk}/preview`, "POST", { catalogue: saved.catalogue, revision: saved.revision }, 409);

    diagnostic("COMP-010 — an incident reveals a conditional component, then recovery hides it without erasing its ledger");
    const states = () => Promise.all([read("/"), read("/feed.atom"), read("/api/v2/components.json")]);
    const visibility = (responses, visible, state) => responses.every(response => response.status === 200) &&
      Boolean(article(responses[0].body, conditional.name)) === visible && Boolean(responses[1].body.match(/Affected components: [^\n<]*/gu)?.some(line => line.includes(conditional.name))) === visible &&
      (() => { const row = JSON.parse(responses[2].body).components.find(component => component.name === conditional.name); return visible ? row?.only_show_if_degraded === true && row.status === state : row === undefined; })();
    await published("Operational conditional component is hidden", states, responses => visibility(responses, false));
    const historyBefore = await queryLocalSql(`SELECT * FROM component_state_history WHERE component_id=${quote(conditional.id)} ORDER BY changed_at,id`);
    conditionalIncident = (await api("/api/app/incidents", "POST", { title: `${prefix} availability incident`, components: [{ componentId: conditional.id, state: "Major outage", relationship: "Primary" }] }, 201)).incident;
    async function publish(lifecycle, customerImpact) {
      await api(`/api/app/incidents/${conditionalIncident.id}/draft`, "PUT", { lifecycle, affectedAudience: "Customers using the affected service", customerImpact, whatStillWorks: "Other services remain available.", details: "The public component list follows the current claims.", nextUpdateAt: lifecycle === "Resolved" ? null : new Date(Date.now() + 3600000).toISOString() });
      await api(`/api/app/incidents/${conditionalIncident.id}/publish`, "POST", { channels: [] });
    }
    await publish("Investigating", "Requests to the affected service are failing.");
    const affected = await published("Major outage appears on page, feed and v2 API", states, responses => visibility(responses, true, "major_outage"));
    assert.equal(new Set(affected.map(response => response.version)).size, 1, "every public representation selects the same generation");
    assert.match(article(affected[0].body, conditional.name), /Major outage/u);
    await publish("Resolved", "Requests have recovered.");
    await published("Recovery hides the conditional component", states, responses => visibility(responses, false));
    const historyAfter = await queryLocalSql(`SELECT * FROM component_state_history WHERE component_id=${quote(conditional.id)} ORDER BY changed_at,id`);
    assert.ok(historyAfter.length > historyBefore.length);
    assert.ok(historyBefore.every(row => historyAfter.some(next => next.id === row.id)), "hiding a component retains every existing ledger entry");
    assert.ok(historyAfter.some(row => row.new_state === "Major outage"));

    diagnostic("COMP-009 — the selected uptime start date excludes earlier measured downtime");
    await updateSettings({ timezone: "America/Los_Angeles" });
    const operator = (await queryLocalSql("SELECT id FROM operators WHERE deactivated_at IS NULL ORDER BY created_at,id LIMIT 1"))[0];
    assert.ok(operator);
    const oldOutage = new Date(Date.now() - 15 * DAY).toISOString(), oldRecovery = new Date(Date.now() - 10 * DAY).toISOString();
    await executeLocalSql(`INSERT INTO component_state_history (id,component_id,previous_state,new_state,cause_type,operator_id,changed_at,created_at,updated_at) VALUES (${quote(randomUUID())},${quote(uptime.id)},'Operational','Major outage','standing-claim',${quote(operator.id)},${quote(oldOutage)},${quote(oldOutage)},${quote(oldOutage)}),(${quote(randomUUID())},${quote(uptime.id)},'Major outage','Operational','standing-claim',${quote(operator.id)},${quote(oldRecovery)},${quote(oldRecovery)},${quote(oldRecovery)})`);
    uptime = (await current()).catalogue.components.find(component => component.id === uptime.id);
    await api(`/api/app/components/${uptime.id}`, "PUT", componentInput(uptime));
    await published("Uptime after the chosen start is fully available", () => read("/"), result => /100\.00%/u.test(article(result.body, uptime.name)));
    await api(`/api/app/components/${uptime.id}`, "PUT", componentInput(uptime, { uptimeStartDate: isoDay(Date.now() - 20 * DAY) }));
    await published("Earlier start includes the measured outage", () => read("/"), result => {
      const percentage = /(\d+(?:\.\d+)?)%/u.exec(article(result.body, uptime.name));
      return result.status === 200 && percentage && Number(percentage[1]) < 100;
    });

    diagnostic("HIST-008 — real imported history older than three years remains browsable through populated months");
    const year = new Date().getUTCFullYear() - 4;
    const files = await ancientSorryFiles(year);
    const source = { source: "sorry", publicAccessAcknowledged: true };
    const imported = moved(await moveIn.apply(moved(await moveIn.preview({ ...source, files }))));
    importJobs.push(imported.door);
    assert.equal(imported.job.state, "completed");
    const statuspageDirectory = new URL("../../fixtures/statuspage/small/", import.meta.url);
    const statuspageFiles = await Promise.all((await readdir(statuspageDirectory)).filter(name => name !== "subscribers.json").map(async name => ({ name, text: (await readFile(new URL(name, statuspageDirectory), "utf8")).replaceAll("2026-01-11", `${year}-02-02`).replaceAll("2026-01-21", `${year + 1}-08-02`).replaceAll("2026-", `${year}-`) })));
    const statuspageImport = moved(await moveIn.apply(moved(await moveIn.preview({ files: statuspageFiles }))));
    importJobs.push(statuspageImport.door);
    assert.equal(statuspageImport.job.state, "completed");
    const importedIncident = (await api("/api/app/incidents")).incidents.find(incident => incident.title === "Elevated API errors" && incident.openedAt.startsWith(`${year}-`));
    assert.ok(importedIncident, "the import's actual native incident is available");
    boundaryId = randomUUID();
    const reference = `INC-${900000000 + Math.floor(Math.random() * 100000000)}`;
    const openedAt = `${year + 2}-01-01T00:00:00.000Z`, resolvedAt = `${year + 2}-01-01T00:30:00.000Z`;
    await executeLocalSql(`INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at) VALUES (${quote(boundaryId)},${quote(reference)},${quote(`${prefix} timezone boundary`)},'Resolved',${quote(openedAt)},${quote(resolvedAt)},${quote(operator.id)},${quote(openedAt)},${quote(resolvedAt)}); INSERT INTO incident_components (id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES (${quote(randomUUID())},${quote(boundaryId)},${quote(uptime.id)},${quote(uptime.name)},'Major outage','Primary',${quote(openedAt)},${quote(openedAt)},${quote(openedAt)}); INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES (${quote(randomUUID())},${quote(boundaryId)},'Resolved','Archive readers','Recovered at the timezone boundary.','','',NULL,${quote(resolvedAt)},${quote(operator.id)},${quote(resolvedAt)},${quote(resolvedAt)})`);
    await api(`/api/app/components/${uptime.id}`, "PUT", componentInput(uptime, { uptimeStartDate: startDate }));
    const index = await published("History index links earlier months", () => read("/history/"), result => result.status === 200 && result.body.includes(`/history/${year}-02`));
    assert.ok(!index.body.includes(`/incidents/${importedIncident.reference}`), "the main history retains its 12-month record window");
    const month = `${year + 1}-12`;
    const boundary = await read(`/history/${month}`);
    assert.equal(boundary.status, 200);
    assert.ok(boundary.body.includes(`/incidents/${reference}`), "a January UTC instant belongs to December in the configured page timezone");
    let path = `/history/${month}`, reachedOldest = false;
    const visited = new Set();
    for (let step = 0; step < 100; step += 1) {
      assert.ok(!visited.has(path), "month navigation cannot loop"); visited.add(path);
      const page = await read(path); assert.equal(page.status, 200, path);
      if (page.body.includes(`/incidents/${importedIncident.reference}`)) { reachedOldest = true; break; }
      const previous = /<a\b[^>]*rel="prev"[^>]*href="([^"]+)"/u.exec(page.body)?.[1];
      assert.ok(previous, "every earlier populated month remains reachable");
      const older = await read(previous); assert.equal(older.status, 200);
      assert.ok(older.body.includes(`rel="next" href="${path}"`), "adjacent populated months link back without empty-month hops");
      path = previous;
    }
    assert.ok(reachedOldest, "previous-month links reach the oldest imported incident");
    assert.ok((await read(`/incidents/${importedIncident.reference}`)).body.includes("Elevated API errors"));
    const primaryHistory = await read("/history", { redirect: "manual" });
    assert.equal(primaryHistory.status, 301); assert.equal(primaryHistory.location, "/history/");
    const legacyMonth = await read(`/history/${year}/february`, { redirect: "manual" });
    assert.equal(legacyMonth.status, 301); assert.equal(legacyMonth.location, "/history/");
    assert.equal((await read(`/history/${year}-13`)).status, 404, "invalid new month paths never become Sorry aliases");
  } finally {
    if (boundaryId) await executeLocalSql(`DELETE FROM incidents WHERE id=${quote(boundaryId)}`);
    for (const importJob of importJobs.reverse()) assert.equal(moved(await moveIn.undo(importJob)).job.state, "undone");
    if (conditionalIncident) await api(`/api/app/incidents/${conditionalIncident.id}`, "DELETE", { reason: "Catalogue journey fixture cleanup." });
    if (newComponents.size || newGroups.size) {
      const latest = await current();
      const catalogue = { components: latest.catalogue.components.filter(component => !newComponents.has(component.id)), groups: latest.catalogue.groups.filter(group => !newGroups.has(group.id)) };
      const cleanup = await api(`${bulk}/preview`, "POST", { catalogue, revision: latest.revision });
      await apply(cleanup);
      assert.ok((await current()).catalogue.components.every(component => !newComponents.has(component.id)), "bulk deletion removes all journey components");
    }
    await updateSettings({ timezone: originalTimezone });
  }
}
