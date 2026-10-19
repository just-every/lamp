import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function csvRows(text) {
  const rows = []; let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\r" || character === "\n") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [header, ...records] = rows;
  return records.map(record => Object.fromEntries(header.map((key, index) => [key, record[index]])));
}

/** UPTIME-009: compose into an existing publishing case, using its real signed-in
 * fetch and migrated D1. No test registration or substitute authentication. */
export async function availabilityReportFlow({ vite, bindings, appFetch }) {
  assert.equal(typeof appFetch, "function", "Pass the publishing suite's authenticated appFetch");
  const db = bindings.DB, prefix = `availability-${randomUUID()}`, component = `${prefix}-component`, empty = `${prefix}-empty`, short = `${prefix}-short`;
  const actor = await db.prepare("SELECT id FROM operators LIMIT 1").first();
  assert.ok(actor, "Publishing fixture must have a real operator");
  const stamp = "2024-01-01T00:00:00.000Z", incidentIds = [], maintenanceIds = [];
  const sql = (query, ...values) => db.prepare(query).bind(...values).run();
  const get = async (query, init) => {
    const response = await appFetch(`/api/app/availability-report?${query}`, init);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response;
  };
  const report = async query => (await get(query)).json();
  const claim = async (id, state, at, kind = "incident") => sql("INSERT INTO component_claim_events(id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", `${prefix}-${randomUUID()}`, component, kind, id, state, at, at, at);
  const history = async (state, at, cause = null, kind = "standing-claim", target = component) => sql("INSERT INTO component_state_history(id,component_id,previous_state,new_state,cause_type,cause_id,operator_id,changed_at,created_at,updated_at) VALUES(?,?,'Operational',?,?,?,?,?,?,?)", `${prefix}-${randomUUID()}`, target, state, kind, cause, actor.id, at, at, at);
  const incident = async (name, start, end, { attach = false, title = name, componentId = component } = {}) => {
    const id = `${prefix}-${name}`; incidentIds.push(id);
    await sql("INSERT INTO incidents(id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at) VALUES(?,?,?,'Resolved',?,?,?,?,?)", id, `INC-${Date.now()}${incidentIds.length}`, title, stamp, end, actor.id, stamp, stamp);
    if (attach) await sql("INSERT INTO incident_components(id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES(?,?,?,?,'Major outage','Primary',?,?,?)", `${id}-attachment`, id, componentId, "Report component", start, stamp, stamp);
    if (componentId === component) { await claim(id, "Major outage", start); await claim(id, null, end); }
    return id;
  };
  try {
    for (const id of [component, empty, short]) await sql("INSERT INTO components(id,group_id,name,description,internal,display_order,note,uptime_start_date,created_at,updated_at) VALUES(?,NULL,?,'',0,1000,'',?,?,?)", id, id === component ? "Availability café 東京 (API)" : id, id === short ? "2024-02-29" : null, stamp, stamp);
    const cross = await incident("cross-boundary", "2024-01-31T23:00:00.000Z", "2024-02-01T01:00:00.000Z", { attach: true });
    const degraded = await incident("degraded", "2024-02-10T00:00:00.000Z", "2024-02-10T02:00:00.000Z");
    await sql("UPDATE component_claim_events SET state='Degraded performance' WHERE cause_id=? AND state IS NOT NULL", degraded);
    const major = await incident("major-overlap", "2024-02-10T00:30:00.000Z", "2024-02-10T01:30:00.000Z", { title: '=SUM(1,2) "Quoted" café 東京 ' + "A long retained customer incident title. ".repeat(4) });
    const masked = await incident("masked-claim", "2024-02-10T00:40:00.000Z", "2024-02-10T00:50:00.000Z");
    const overflow = [];
    for (let index = 0; index < 16; index++) overflow.push(await incident(`related-${index}`, "2024-02-10T00:40:00.000Z", "2024-02-10T00:50:00.000Z", { title: `Related customer incident ${index}: payment processing affected by the upstream outage` }));
    const before = await incident("before", "2024-01-10T00:00:00.000Z", "2024-01-10T01:00:00.000Z", { attach: true });
    const detached = await incident("detached", "2024-01-20T00:00:00.000Z", "2024-01-21T00:00:00.000Z", { attach: true });
    await sql("UPDATE incidents SET resolved_at='2024-02-15T00:00:00.000Z' WHERE id=?", detached);
    const after = await incident("at-end", "2024-03-01T00:00:00.000Z", "2024-03-01T01:00:00.000Z");
    await incident("other-component", "2024-02-10T00:00:00.000Z", "2024-02-10T01:00:00.000Z", { attach: true, componentId: empty });
    const legacy = `${prefix}-legacy`;
    incidentIds.push(legacy);
    await sql("INSERT INTO incidents(id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at) VALUES(?,?,?,'Resolved',?,?,?,?,?)", legacy, `INC-${Date.now()}${incidentIds.length}`, "Imported ledger predating claim events", stamp, "2024-02-15T00:10:00.000Z", actor.id, stamp, stamp);
    await sql("INSERT INTO incident_components(id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES(?,?,?,?,'Operational','Primary',?,?,?)", `${legacy}-attachment`, legacy, component, "Report component", "2024-02-15T00:00:00.000Z", stamp, stamp);
    const releaseOnly = `${prefix}-legacy-release`;
    incidentIds.push(releaseOnly);
    await sql("INSERT INTO incidents(id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,created_at,updated_at) VALUES(?,?,?,'Resolved',?,?,?,?,?)", releaseOnly, `INC-${Date.now()}${incidentIds.length}`, "Legacy incident with only a ledger release", stamp, "2024-02-15T00:10:00.000Z", actor.id, stamp, stamp);
    await sql("INSERT INTO incident_components(id,incident_id,component_id,component_name,state,relationship,published_at,created_at,updated_at) VALUES(?,?,?,?,'Major outage','Primary',?,?,?)", `${releaseOnly}-attachment`, releaseOnly, component, "Report component", "2024-01-31T00:00:00.000Z", stamp, stamp);
    await claim(releaseOnly, null, "2024-02-01T00:30:00.000Z");
    for (const [state, at, cause] of [
      ["Operational", stamp, null], ["Major outage", "2024-01-10T00:00:00.000Z", before], ["Operational", "2024-01-10T01:00:00.000Z", before],
      ["Major outage", "2024-01-31T23:00:00.000Z", cross], ["Operational", "2024-02-01T01:00:00.000Z", cross],
      ["Degraded performance", "2024-02-10T00:00:00.000Z", degraded], ["Major outage", "2024-02-10T00:30:00.000Z", major],
      ["Degraded performance", "2024-02-10T01:30:00.000Z", major], ["Operational", "2024-02-10T02:00:00.000Z", degraded],
      ["Under maintenance", "2024-02-20T00:00:00.000Z", null], ["Operational", "2024-02-20T02:00:00.000Z", null],
      ["Major outage", "2024-03-01T00:00:00.000Z", after], ["Operational", "2024-03-01T01:00:00.000Z", after],
    ]) await history(state, at, cause, cause ? "incident" : "standing-claim");
    // A correction overrides the aggregate major state for 15 minutes, while
    // keeping every original incident in the report membership.
    const correctionHistory = `${prefix}-correction-history`;
    await sql("INSERT INTO component_state_history(id,component_id,previous_state,new_state,cause_type,operator_id,changed_at,created_at,updated_at) VALUES(?,?,'Major outage','Degraded performance','correction',?,?,?,?)", correctionHistory, component, actor.id, "2024-02-10T00:45:00.000Z", stamp, stamp);
    await sql("INSERT INTO component_state_corrections(id,component_id,history_id,state,starts_at,ends_at,reason,operator_id,created_at,updated_at) VALUES(?,?,?,'Degraded performance','2024-02-10T00:45:00.000Z','2024-02-10T01:00:00.000Z','Retained corrected interval',?,?,?)", `${prefix}-correction`, component, correctionHistory, actor.id, stamp, stamp);
    for (const [name, start, end] of [["inside", "2024-02-20T00:00:00.000Z", "2024-02-20T02:00:00.000Z"], ["cross", "2024-01-31T23:00:00.000Z", "2024-02-01T00:01:00.000Z"], ["outside", "2024-03-01T00:00:00.000Z", "2024-03-01T01:00:00.000Z"]]) {
      const id = `${prefix}-maintenance-${name}`; maintenanceIds.push(id);
      await sql("INSERT INTO maintenance(id,reference,title,state,starts_at,ends_at,completed_at,created_by_operator_id,created_at,updated_at) VALUES(?,?,?,'Completed',?,?,?,?,?,?)", id, `SCH-${Date.now()}${maintenanceIds.length}`, `Maintenance ${name}`, start, end, end, actor.id, stamp, stamp);
      await sql("INSERT INTO maintenance_components(id,maintenance_id,component_id,component_name,state,created_at,updated_at) VALUES(?,?,?,?,'Under maintenance',?,?)", `${id}-component`, id, component, "Report component", stamp, stamp);
    }
    const base = `component=${encodeURIComponent(component)}`, month = await report(`${base}&month=2024-02&format=json`);
    assert.equal(month.startsAt, "2024-02-01T00:00:00.000Z"); assert.equal(month.endsAt, "2024-03-01T00:00:00.000Z");
    assert.equal(month.basis, "claimed"); assert.equal(month.timezone, "UTC");
    assert.equal(month.downtimeMinutes, "142.50", "Overlap is aggregated once, degraded minutes weighted at half, corrections applied, maintenance excluded");
    assert.equal(month.uptime, `${(Math.floor((100 - 142.5 / (29 * 1440) * 100) * 100) / 100).toFixed(2)}%`);
    assert.deepEqual(new Set(month.incidents.map(row => row.id)), new Set([cross, degraded, major, masked, legacy, releaseOnly, ...overflow]), "Includes overlapping, detached-ledger and legacy public claims without including other components or out-of-period claims");
    assert.deepEqual(new Set(month.maintenance.map(row => row.id)), new Set(maintenanceIds.slice(0, 2)));
    const { createSnapshotRepository } = await vite.ssrLoadModule("/src/core/features/public-snapshot/repository.ts");
    const { computeUptime } = await vite.ssrLoadModule("/src/core/features/public-snapshot/uptime.ts");
    const { createServerExtensionMount } = await vite.ssrLoadModule("/src/core/app/extensions/server.ts");
    const policies = createServerExtensionMount().publicSnapshotPolicies, snapshot = await createSnapshotRepository(db).load();
    const bounds = { startsAt: Date.parse(month.startsAt), endsAt: Date.parse(month.endsAt) };
    const pageFigure = computeUptime(snapshot, component, bounds.endsAt, "UTC", policies, null, bounds);
    assert.equal(month.uptime, pageFigure.percentage, "The report and public page use exactly the same window and policy math");
    const csv = await get(`${base}&month=2024-02&format=csv`), rows = csvRows(await csv.text());
    assert.match(csv.headers.get("content-type"), /text\/csv/); assert.match(csv.headers.get("content-disposition"), /attachment/);
    assert.equal(rows[0].uptime, pageFigure.percentage); assert.equal(rows[0].weighted_downtime_minutes, "142.50");
    assert.equal(rows.find(row => row.id === major).title.startsWith("'=SUM"), true, "Spreadsheet formulas are neutralised");
    assert.match(rows.find(row => row.id === major).title, /café 東京/);
    const quarter = await report(`${base}&quarter=2024-Q1&format=json`);
    assert.equal(quarter.startsAt, "2024-01-01T00:00:00.000Z"); assert.equal(quarter.endsAt, "2024-04-01T00:00:00.000Z");
    assert.ok(quarter.incidents.some(row => row.id === before)); assert.ok(quarter.incidents.some(row => row.id === after)); assert.ok(quarter.incidents.some(row => row.id === detached));
    const lastQuarter = await report(`${base}&quarter=2023-Q4&format=json`);
    assert.equal(lastQuarter.endsAt, "2024-01-01T00:00:00.000Z"); assert.equal(lastQuarter.uptime, null);
    const future = await report(`${base}&quarter=9998-Q4&format=json`);
    assert.equal(future.uptime, null); assert.equal(future.downtimeMinutes, null, "Future periods never invent uptime");
    assert.equal((await report(`component=${empty}&month=2024-02&format=json`)).uptime, null, "No history remains no data");
    await history("Major outage", "2024-02-29T12:00:00.000Z", null, "standing-claim", short);
    await history("Operational", "2024-02-29T13:00:00.000Z", null, "standing-claim", short);
    assert.equal((await report(`component=${short}&month=2024-02&format=json`)).uptime, "91.66%", "Short history counts only tracked elapsed time");
    const pageSettings = await db.prepare("SELECT timezone FROM page_settings WHERE id='default'").first();
    try {
      await sql("UPDATE page_settings SET timezone='Australia/Brisbane' WHERE id='default'");
      await sql("UPDATE components SET uptime_start_date='2024-02-29' WHERE id=?", component);
      const localStartReport = await report(`${base}&month=2024-02&format=json`);
      const localStartPage = computeUptime(snapshot, component, bounds.endsAt, 'Australia/Brisbane', policies, '2024-02-29', bounds);
      assert.equal(localStartReport.uptime, localStartPage.percentage, 'Configured uptime start dates retain the page timezone within UTC report bounds');
    } finally {
      await sql("UPDATE page_settings SET timezone=? WHERE id='default'", pageSettings.timezone);
      await sql("UPDATE components SET uptime_start_date=NULL WHERE id=?", component);
    }
    const pdf = await get(`${base}&month=2024-02&format=pdf`), document = Buffer.from(await pdf.arrayBuffer()).toString("ascii");
    assert.match(pdf.headers.get("content-type"), /application\/pdf/); assert.match(pdf.headers.get("content-disposition"), /attachment/);
    assert.ok(document.startsWith("%PDF-")); assert.match(document, /%%EOF\s*$/); assert.match(document, /FEFF0041007600610069006c006100620069006c006900740079/);
    const startxref = Number(document.match(/startxref\n(\d+)\n/)?.[1]);
    assert.equal(document.slice(startxref, startxref + 4), "xref", "Cross-reference offsets are byte-accurate with Unicode input");
    const xrefs = document.slice(startxref).split("\n").slice(3).filter(line => /^\d{10} 00000 n /.test(line));
    xrefs.forEach((line, index) => assert.equal(document.slice(Number(line.slice(0, 10))).startsWith(`${index + 1} 0 obj`), true));
    assert.ok(Number(document.match(/\/Type \/Pages \/Count (\d+)/)?.[1]) >= 2, "Retained incident detail paginates");
    if (process.env.LAMP_SCREENSHOTS) await writeFile(`${process.env.LAMP_SCREENSHOTS}/availability-fixture-month.pdf`, Buffer.from(document, "ascii"));
    for (const invalid of [base, `${base}&month=2024-13`, `${base}&month=0000-01`, `${base}&quarter=2024-Q5`, `${base}&month=2024-02&quarter=2024-Q1`, `${base}&month=2024-02&format=html`, `${base}&month=2024-02&unknown=1`]) {
      const response = await appFetch(`/api/app/availability-report?${invalid}`);
      assert.equal(response.status, 400); assert.equal(typeof (await response.json()).error, "string");
    }
    assert.equal((await appFetch("/api/app/availability-report?component=missing&month=2024-02")).status, 404);
    assert.equal((await appFetch(`/api/app/availability-report?${base}&month=2024-02`, { headers: { Cookie: "" } })).status, 401, "Operator report refuses an absent session through the real application middleware");
  } finally {
    for (const id of [component, empty, short]) {
      await sql("DELETE FROM component_state_corrections WHERE component_id=?", id);
      await sql("DELETE FROM component_state_history WHERE component_id=?", id);
      await sql("DELETE FROM component_claim_events WHERE component_id=?", id);
    }
    for (const id of incidentIds) { await sql("DELETE FROM incident_components WHERE incident_id=?", id); await sql("DELETE FROM incidents WHERE id=?", id); }
    for (const id of maintenanceIds) { await sql("DELETE FROM maintenance_components WHERE maintenance_id=?", id); await sql("DELETE FROM maintenance WHERE id=?", id); }
    for (const id of [component, empty, short]) await sql("DELETE FROM components WHERE id=?", id);
  }
}
