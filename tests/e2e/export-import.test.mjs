import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { getPlatformProxy } from "wrangler";

import { contract } from "../contract.mjs";
import { applyOwnerMigrations } from "../../scripts/owner-migrations.mjs";
import { importHistoryForRestore, undoHistoryAfterRestore } from "../betterstack/portability.mjs";

const configPath = "wrangler.jsonc";
const logo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm4kAAAAASUVORK5CYII=", "base64");

function run(args) {
  execFileSync("pnpm", args, { cwd: process.cwd(), stdio: "pipe" });
}

function platformFor(statePath) {
  return getPlatformProxy({ configPath, remoteBindings: false, persist: { path: join(statePath, "v3") } });
}

function quoted(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

contract("HIST-004", "export restores every JSON entity, settings and audit entry plus original image bytes into an empty local deployment", async () => {
  const sourceState = await mkdtemp(join(tmpdir(), "lamp-export-source-"));
  const targetState = await mkdtemp(join(tmpdir(), "lamp-export-target-"));
  const archive = await mkdtemp(join(tmpdir(), "lamp-export-archive-"));
  const restoredArchive = await mkdtemp(join(tmpdir(), "lamp-export-restored-"));
  let importedHistory;
  try {
    run(["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", sourceState, "--config", configPath]);
    await applyOwnerMigrations(configPath, ["--local", "--persist-to", sourceState]);
    const source = await platformFor(sourceState);
    try {
      await source.env.DB.batch([
        source.env.DB.prepare("INSERT INTO operators (id, email, display_name, is_setup_operator, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind("operator-export", "owner@example.test", "Owner", 1, "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO page_settings (id, page_name, tagline, accent_color, timezone, hostname, footer_credit_enabled, logo_key, logo_content_type, widget_allowed_origins, mail_from_address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("default", "Export status", "Portable archive", "#16794c", "UTC", "status.example.test", 1, "branding/original.png", "image/png", '["https://embed.example.test"]', "status@example.test", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO component_groups (id, name, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("group-export", "Core services", 1, "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO components (id, group_id, name, description, internal, display_order, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("component-export", "group-export", "Public API", "Customer API", 0, 1, "Watch this component.", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO component_state_history (id, component_id, previous_state, new_state, cause_type, cause_id, operator_id, supersedes_history_id, changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("history-export", "component-export", "Operational", "Major outage", "incident", "incident-export", "operator-export", null, "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO incidents (id, reference, title, lifecycle, opened_at, resolved_at, created_by_operator_id, deleted_at, deletion_reason, peak_impact, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("incident-export", "INC-4242", "API availability", "Resolved", "2026-09-08T00:00:00.000Z", "2026-09-08T00:15:00.000Z", "operator-export", null, null, "Major outage", "2026-09-08T00:00:00.000Z", "2026-09-08T00:15:00.000Z"),
        source.env.DB.prepare("INSERT INTO incident_components (id, incident_id, component_id, component_name, state, relationship, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("incident-component-export", "incident-export", "component-export", "Public API", "Major outage", "Primary", "2026-09-08T00:05:00.000Z", "2026-09-08T00:00:00.000Z", "2026-09-08T00:05:00.000Z"),
        source.env.DB.prepare("INSERT INTO incident_updates (id, incident_id, lifecycle, affected_audience, customer_impact, what_still_works, details, next_update_at, published_at, author_operator_id, corrects_update_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("update-export", "incident-export", "Resolved", "API customers", "Requests failed", "Dashboard remained available", "The incident is resolved.", "2026-09-08T00:15:00.000Z", "2026-09-08T00:15:00.000Z", "operator-export", null, "2026-09-08T00:00:00.000Z", "2026-09-08T00:15:00.000Z"),
        source.env.DB.prepare("INSERT INTO incident_reports (id, incident_id, summary, timeline, cause, remediation, published_at, author_operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("report-export", "incident-export", "Summary", "Timeline", "Cause", "Remediation", "2026-09-08T01:00:00.000Z", "operator-export", "2026-09-08T01:00:00.000Z", "2026-09-08T01:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO maintenance (id, reference, title, state, starts_at, ends_at, completed_at, created_by_operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("maintenance-export", "SCH-4242", "Database maintenance", "Completed", "2026-09-09T00:00:00.000Z", "2026-09-09T01:00:00.000Z", "2026-09-09T01:00:00.000Z", "operator-export", "2026-09-08T00:00:00.000Z", "2026-09-09T01:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO maintenance_components (id, maintenance_id, component_id, component_name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind("maintenance-component-export", "maintenance-export", "component-export", "Public API", "Under maintenance", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO import_maintenance_updates (id,maintenance_id,body,published_at,source_states) VALUES (?,?,?,?,?)").bind("imported-maintenance-update", "maintenance-export", "Original provider maintenance message", "2026-09-09T00:15:00.000Z", "[]"),
        source.env.DB.prepare("INSERT INTO maintenance_notices (id, maintenance_id, kind, body, published_at, author_operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("notice-export", "maintenance-export", "completed", "Maintenance complete.", "2026-09-09T01:00:00.000Z", "operator-export", "2026-09-09T01:00:00.000Z", "2026-09-09T01:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO subscribers (id, channel, destination, contact_email, state, selection_mode, token_hash, deactivation_reason, deactivated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("subscriber-export", "email", "reader@example.test", "reader@example.test", "active", "selected", "token-hash-export", null, null, "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO subscriber_components (id, subscriber_id, component_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind("subscriber-component-export", "subscriber-export", "component-export", "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
        source.env.DB.prepare("INSERT INTO notification_deliveries (id, subscriber_id, incident_update_id, maintenance_id, channel, outcome, queued_at, outcome_at, created_at, updated_at, notification_event_id, notification_event_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("delivery-export", "subscriber-export", "update-export", null, "email", "delivered", "2026-09-08T00:15:00.000Z", "2026-09-08T00:15:01.000Z", "2026-09-08T00:15:00.000Z", "2026-09-08T00:15:01.000Z", "update-export", "incident-update"),
        source.env.DB.prepare("INSERT INTO alert_sources (id,name,credential_kind,bearer_token_hash,deduplication_path,title_path,state_path,created_by_operator_id,created_at,updated_at,grouped_preset,label_matchers_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind("group-source-export","Production Alertmanager","bearer-token","synthetic-archive-hash","preset:alertmanager","preset:alertmanager","preset:alertmanager","operator-export","2026-09-08","2026-09-08","alertmanager",JSON.stringify([{componentId:"component-export",labels:{service:"api",region:"us-east"}}])),
        source.env.DB.prepare("INSERT INTO alert_group_members (source_id,incident_id,group_key,fingerprint,state,received_at,recovered_at) VALUES (?,?,?,?,?,?,?)").bind("group-source-export","incident-export","service-group","alert-fingerprint","resolved","2026-09-08T00:15:00.000Z","2026-09-08T00:15:00.000Z"),
        source.env.DB.prepare("INSERT INTO audit_entries (id, entity_type, entity_id, action, operator_id, reason, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("audit-export", "component-state-history", "history-export", "corrected", "operator-export", "Verified export", '{"before":"Operational","after":"Major outage"}', "2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z"),
      ]);
      await source.env.SNAPSHOTS.put("branding/original.png", logo, { httpMetadata: { contentType: "image/png", contentDisposition: "attachment; filename=brand.png", cacheControl: "public, max-age=60" }, customMetadata: { owner: "portable-brand" } });
      importedHistory=await importHistoryForRestore(source.env.DB);
    } finally {
      await source.dispose();
    }

    run(["run", "export:cloudflare", "--", "--out", archive, "--persist-to", sourceState]);
    const manifestPath = join(archive, "manifest.json");
    const originalManifest = await readFile(manifestPath, "utf8");
    const damagedManifest = JSON.parse(originalManifest);
    damagedManifest.migrations[0].sha256 = "0".repeat(64);
    await writeFile(manifestPath, JSON.stringify(damagedManifest));
    assert.throws(() => run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", targetState]), /Command failed/);
    const untouched = await platformFor(targetState);
    try {
      const tables = await untouched.env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
      assert.equal(tables.results.length, 0, "schema mismatch must be rejected before destination migrations or records are written");
      assert.equal((await untouched.env.SNAPSHOTS.list()).objects.length, 0);
    } finally { await untouched.dispose(); }
    await writeFile(manifestPath, originalManifest);
    const originalEntities = await readFile(join(archive, "entities.json"));
    const incompatibleEntities = JSON.parse(originalEntities);
    incompatibleEntities.tables.push({ name: "missing_owner_table", dependsOn: [], rows: [{ id: "cannot-restore" }] });
    const incompatibleBytes = Buffer.from(JSON.stringify(incompatibleEntities));
    const incompatibleManifest = JSON.parse(originalManifest);
    incompatibleManifest.database.sha256 = createHash("sha256").update(incompatibleBytes).digest("hex");
    await writeFile(join(archive, "entities.json"), incompatibleBytes);
    await writeFile(manifestPath, JSON.stringify(incompatibleManifest));
    const partialState = join(targetState, "partial-attempt");
    assert.throws(() => run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", partialState]), /Command failed/, "a real SQL restore failure must stop without publishing");
    await writeFile(join(archive, "entities.json"), originalEntities);
    await writeFile(manifestPath, originalManifest);
    assert.throws(() => run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", partialState]), /Command failed/, "a failed destination must not be silently overwritten on retry");
    run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", targetState]);
    assert.throws(() => run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", targetState]), /Command failed/, "rerunning import must never overwrite a populated destination");
    run(["run", "export:cloudflare", "--", "--out", restoredArchive, "--persist-to", targetState]);

    const entities = JSON.parse(await readFile(join(archive, "entities.json"), "utf8"));
    const target = await platformFor(targetState);
    try {
      const restored = [];
      for (const table of entities.tables) {
        const rows = await target.env.DB.prepare(`SELECT * FROM ${quoted(table.name)} ORDER BY rowid`).all();
        restored.push({ name: table.name, dependsOn: table.dependsOn, rows: rows.results });
      }
      assert.deepEqual(restored, entities.tables);
      assert.ok(entities.tables.find((table) => table.name === "page_settings")?.rows.length, "settings must be JSON entities in the archive");
      assert.ok(entities.tables.find((table) => table.name === "audit_entries")?.rows.length, "audit entries must be JSON entities in the archive");
      for (const name of ["components", "component_state_history", "incidents", "incident_updates", "incident_reports", "maintenance", "maintenance_notices", "subscribers", "notification_deliveries"]) {
        assert.ok(entities.tables.find((table) => table.name === name)?.rows.length, `${name} must be represented by a real entity row`);
      }
      const restoredLogo = await target.env.SNAPSHOTS.get("branding/original.png");
      assert.equal(restoredLogo?.httpMetadata?.contentType, "image/png");
      assert.equal(restoredLogo.httpMetadata.contentDisposition, "attachment; filename=brand.png");
      assert.equal(restoredLogo.httpMetadata.cacheControl, "public, max-age=60");
      assert.deepEqual(restoredLogo.customMetadata, { owner: "portable-brand" });
      assert.deepEqual(Buffer.from(await restoredLogo.arrayBuffer()), logo);
      await undoHistoryAfterRestore(target.env.DB,importedHistory);
    } finally {
      await target.dispose();
    }
    assert.deepEqual(
      JSON.parse(await readFile(join(restoredArchive, "entities.json"), "utf8")),
      entities,
      "a second export after import must preserve the entire entity graph",
    );
    // Archives from before subscriber reporting have no observed daily facts.
    // Restore their real inventory as a new baseline rather than inventing it
    // from historical creation dates.
    const legacyEntities = { ...entities, tables: entities.tables.filter(table => !table.name.startsWith("subscriber_reporting_")) };
    const legacyBytes = Buffer.from(JSON.stringify(legacyEntities));
    const legacyManifest = JSON.parse(originalManifest);
    legacyManifest.database.sha256 = createHash("sha256").update(legacyBytes).digest("hex");
    await writeFile(join(archive, "entities.json"), legacyBytes);
    await writeFile(manifestPath, JSON.stringify(legacyManifest));
    const legacyState = join(targetState, "legacy-copy");
    run(["run", "import:cloudflare", "--", "--from", archive, "--persist-to", legacyState]);
    const legacy = await platformFor(legacyState);
    try {
      const baseline = (await legacy.env.DB.prepare("SELECT channel, eligible FROM subscriber_reporting_baseline ORDER BY channel").all()).results;
      const actual = (await legacy.env.DB.prepare("SELECT channels.channel, COUNT(s.id) AS eligible FROM (SELECT 'email' AS channel UNION ALL SELECT 'webhook') channels LEFT JOIN subscribers s ON s.channel = channels.channel AND s.state IN ('pending', 'active') AND s.destination NOT LIKE 'deleted:%' GROUP BY channels.channel ORDER BY channels.channel").all()).results;
      assert.deepEqual(baseline, actual);
      assert.equal((await legacy.env.DB.prepare("SELECT COUNT(*) AS n FROM subscriber_reporting_daily").first()).n, 0);
      assert.ok((await legacy.env.DB.prepare("SELECT started_at FROM subscriber_reporting_tracking WHERE id = 1").first()).started_at);
    } finally { await legacy.dispose(); }
  } finally {
    await Promise.all([rm(sourceState, { recursive: true, force: true }), rm(targetState, { recursive: true, force: true }), rm(archive, { recursive: true, force: true }), rm(restoredArchive, { recursive: true, force: true })]);
  }
});


test("owner sidecar migrations apply once and survive export/import/export", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "lamp-owner-portability-"));
  const original = process.cwd();
  const sourceState = join(sandbox, "source");
  const targetState = join(sandbox, "target");
  const archive = join(sandbox, "archive");
  const config = resolve(configPath);
  const execute = (args) => execFileSync("pnpm", args, { cwd: sandbox, stdio: "pipe" });
  try {
    await mkdir(join(sandbox, "migrations", "ext"), { recursive: true });
    await symlink(join(original, "migrations", "core"), join(sandbox, "migrations", "core"));
    await symlink(join(original, "node_modules"), join(sandbox, "node_modules"));
    await writeFile(join(sandbox, "package.json"), JSON.stringify({ private: true, packageManager: "pnpm@10.12.4" }));
    await writeFile(join(sandbox, "migrations", "ext", "0001_owner_labels.sql"), await readFile(join(original, "tests/e2e/fixtures/owner-portability.sql")));
    execute(["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", sourceState, "--config", config]);
    const migrationScript = `import { applyOwnerMigrations } from ${JSON.stringify(join(original, "scripts", "owner-migrations.mjs"))}; await applyOwnerMigrations(${JSON.stringify(config)}, ["--local", "--persist-to", ${JSON.stringify(sourceState)}]);`;
    for (let attempt = 0; attempt < 2; attempt++) execFileSync(process.execPath, ["--input-type=module", "-e", migrationScript], { cwd: sandbox, stdio: "pipe" });
    execute(["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", sourceState, "--config", config, "--command", "DELETE FROM owner_labels WHERE id = 'deleted'; DELETE FROM owner_empty;"]);
    execute(["exec", "node", join(original, "scripts", "export.mjs"), "--config", config, "--persist-to", sourceState, "--out", archive]);
    // Corrupt the entity graph with a valid checksum: FK enforcement must
    // reject it, roll back all data writes, and restore application triggers.
    const entitiesPath = join(archive, "entities.json");
    const manifestPath = join(archive, "manifest.json");
    const validEntities = await readFile(entitiesPath);
    const validManifest = await readFile(manifestPath);
    const invalid = JSON.parse(validEntities);
    invalid.tables.find((table) => table.name === "owner_tree").rows[0].parent = "absent-parent";
    const invalidBytes = Buffer.from(JSON.stringify(invalid));
    const invalidManifest = JSON.parse(validManifest);
    invalidManifest.database.sha256 = createHash("sha256").update(invalidBytes).digest("hex");
    await writeFile(entitiesPath, invalidBytes);
    await writeFile(manifestPath, JSON.stringify(invalidManifest));
    const failedState = join(sandbox, "invalid-graph");
    assert.throws(() => execute(["exec", "node", join(original, "scripts", "import.mjs"), "--config", config, "--persist-to", failedState, "--from", archive]), /Command failed/);
    const failedRows = JSON.parse(execute(["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", failedState, "--config", config, "--json", "--command", "SELECT id FROM owner_labels ORDER BY id; SELECT name FROM sqlite_master WHERE type='trigger' AND name='owner_label_insert'; PRAGMA foreign_key_check;"]).toString());
    assert.deepEqual(failedRows[0].results, [{ id: "deleted" }, { id: "owner-1" }], "failed restore rolls back to migration seed rows");
    assert.deepEqual(failedRows[1].results, [{ name: "owner_label_insert" }], "failed restore restores triggers transactionally");
    assert.deepEqual(failedRows[2].results, [], "invalid references never commit");
    await writeFile(entitiesPath, validEntities);
    await writeFile(manifestPath, validManifest);
    const laterMigration = join(sandbox, "migrations", "ext", "0002_backfill_owner_labels.sql");
    await writeFile(laterMigration, "UPDATE owner_labels SET label = 'Backfilled owner intent';");
    assert.throws(() => execute(["exec", "node", join(original, "scripts", "import.mjs"), "--config", config, "--persist-to", targetState, "--from", archive]), /Command failed/, "restoring an older archive must not run later backfills against an empty table and then mark them applied");
    await rm(laterMigration);
    execute(["exec", "node", join(original, "scripts", "import.mjs"), "--config", config, "--persist-to", targetState, "--from", archive]);
    const restored = join(sandbox, "restored");
    execute(["exec", "node", join(original, "scripts", "export.mjs"), "--config", config, "--persist-to", targetState, "--out", restored]);
    const entities = JSON.parse(await readFile(join(archive, "entities.json"), "utf8"));
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_labels").rows, [{ id: "owner-1", label: "Preserve this owner intent" }]);
    assert.deepEqual(JSON.parse(await readFile(join(restored, "entities.json"), "utf8")), entities);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_compound").rows, [{ category: "a", name: "first", value: "Owner value A" }, { category: "b", name: "second", value: "Owner value B" }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_empty").rows, []);
    assert.deepEqual(entities.tables.find((table) => table.name === "xcf_owner").rows, [{ id: "Must not be mistaken for a reserved table" }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "sqliteXowner").rows, [{ id: "Owner table, not SQLite metadata" }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_changes").rows, []);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_generated").rows, [{ id: "generated", qty: 3, total: 6 }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_tree").rows, [{ id: "a-child", parent: "z-parent" }, { id: "z-parent", parent: null }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_left").rows, [{ id: "left", right_id: "right" }]);
    assert.deepEqual(entities.tables.find((table) => table.name === "owner_right").rows, [{ id: "right", left_id: "left" }]);
    const triggerOutput = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", targetState, "--config", config, "--json", "--command", "INSERT INTO owner_labels VALUES ('after-restore', 'Trigger remains active'); SELECT label FROM owner_changes"], { cwd: sandbox, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    assert.match(triggerOutput, /Trigger remains active/);
    assert.equal(JSON.parse(await readFile(join(archive, "manifest.json"), "utf8")).ownerMigrations.length, 1);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});
