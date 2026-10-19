import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseArgs } from "./ops-config.mjs";
import { archivePersistence, openArchivePlatform } from "./archive-runtime.mjs";
import { readArchive } from "./archive-validation.mjs";
import { applyOwnerMigrations } from "./owner-migrations.mjs";
import { assertNewManagedDestination, platformLedger } from "./platform-ledger.mjs";

function databaseFlags(flags) {
  return flags.get("remote") ? ["--remote"] : ["--local", "--persist-to", archivePersistence(flags)];
}

function quotedIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

// The checkout's own Wrangler, run by this Node: no global pnpm needed.
function runWrangler(args) {
  try {
    execFileSync(process.execPath, [resolve("node_modules", "wrangler", "bin", "wrangler.js"), ...args], { stdio: "inherit" });
  } catch {
    throw new Error(`wrangler ${args.join(" ")} failed.`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const source = flags.get("from");
  if (!source) throw new Error("node scripts/import.mjs requires --from <export-directory>.");
  const input = resolve(source);
  const { manifest, entities } = await readArchive(input);
  const tables = entities.tables;

  const remote = Boolean(flags.get("remote"));
  let archive = await openArchivePlatform(flags);
  const configPath = archive.configPath;
  let platform = archive.platform;
  // RER Managed applies this revision itself and keeps its own migration ledger,
  // so a new Managed installation is restored in place; any other destination
  // must be empty and is migrated here.
  let managed, keepConfig = false;
  try {
    const existingTables = (await platform.env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND lower(substr(name, 1, 7)) <> 'sqlite_' AND lower(substr(name, 1, 4)) <> '_cf_' AND name NOT IN ('d1_migrations')").all()).results.map((row) => String(row.name));
    managed = existingTables.includes(platformLedger);
    if (managed) await assertNewManagedDestination(platform.env.DB, existingTables, tables);
    const existingObjects = await platform.env.SNAPSHOTS.list({ limit: 1 });
    if ((!managed && existingTables.length) || existingObjects.objects.length) throw new Error("Import requires an empty D1 database and R2 bucket; create a new deployment instead of overwriting existing records.");
    keepConfig = remote && !managed;
  } finally {
    await archive.dispose({ keepConfig });
  }

  if (!managed) {
    try {
      runWrangler(["d1", "migrations", "apply", "DB", "--config", configPath, ...databaseFlags(flags)]);
      await applyOwnerMigrations(configPath, databaseFlags(flags));
    } catch (cause) {
      throw new Error("Restore stopped during migrations. Keep the source archive and restore into a new empty database and bucket; the partial destination has not been published.", { cause });
    } finally {
      if (remote) await rm(configPath, { force: true });
    }
  }
  archive = await openArchivePlatform(flags);
  platform = archive.platform;
  try {
    // Migration seeds are schema setup, not archived owner data. Disable
    // application triggers while replacing every table, including empty ones,
    // so restore cannot create audit rows or resurrect deleted seed records.
    const triggers = (await platform.env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL").all()).results;
    // Keep the entire data graph in one transaction. Deferral permits valid
    // self references and inter-table cycles, while commit still enforces FKs.
    // Trigger removal and restoration are transactional too: failed data cannot
    // leave the destination with altered behavior or partially inserted rows.
    const statements = [
      platform.env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
      ...triggers.map((trigger) => platform.env.DB.prepare(`DROP TRIGGER ${quotedIdentifier(trigger.name)}`)),
      ...tables.map((table) => platform.env.DB.prepare(`DELETE FROM ${quotedIdentifier(table.name)}`)),
    ];
    for (const table of tables) {
      if (table.rows.length === 0) continue;
      const schema = (await platform.env.DB.prepare(`PRAGMA table_xinfo(${quotedIdentifier(table.name)})`).all()).results;
      const writable = new Set(schema.filter((column) => column.hidden === 0).map((column) => column.name));
      const columns = Object.keys(table.rows[0]).filter((name) => writable.has(name));
      const unknown = Object.keys(table.rows[0]).filter((name) => !schema.some((column) => column.name === name));
      if (unknown.length) throw new Error(`Unknown archived columns in ${table.name}: ${unknown.join(", ")}`);
      const sql = `INSERT INTO ${quotedIdentifier(table.name)} (${columns.map(quotedIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
      for (const row of table.rows) statements.push(platform.env.DB.prepare(sql).bind(...columns.map((column) => row[column])));
    }
    // Older archives predate anonymous subscriber trend facts. Begin a fresh
    // baseline at restore time; creation dates cannot reconstruct past changes.
    if (!tables.some(table => table.name === "subscriber_reporting_tracking")) {
      statements.push(
        platform.env.DB.prepare("DELETE FROM subscriber_reporting_daily"),
        platform.env.DB.prepare("DELETE FROM subscriber_reporting_baseline"),
        platform.env.DB.prepare(`INSERT INTO subscriber_reporting_baseline
          SELECT channels.channel, COUNT(s.id)
          FROM (SELECT 'email' AS channel UNION ALL SELECT 'webhook') channels
          LEFT JOIN subscribers s ON s.channel = channels.channel
            AND s.state IN ('pending', 'active') AND s.destination NOT LIKE 'deleted:%'
          GROUP BY channels.channel`),
        platform.env.DB.prepare("INSERT INTO subscriber_reporting_tracking(id, started_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at"),
      );
    }
    statements.push(...triggers.map((trigger) => platform.env.DB.prepare(trigger.sql)));
    await platform.env.DB.batch(statements);
    for (const object of manifest.objects) {
      const bytes = await readFile(join(input, "objects", object.file));
      const httpMetadata = object.httpMetadata ?? (object.contentType ? { contentType: object.contentType } : undefined);
      if (httpMetadata?.cacheExpiry) httpMetadata.cacheExpiry = new Date(httpMetadata.cacheExpiry);
      await platform.env.SNAPSHOTS.put(object.key, bytes, { httpMetadata, customMetadata: object.customMetadata });
    }
  } catch (cause) {
    throw new Error(`Restore stopped before completion: ${cause instanceof Error ? cause.message : cause}. Keep the source archive and restore into a new empty database and bucket. Do not route traffic to this partial destination.`);
  } finally {
    await archive.dispose();
  }
  console.log(`Imported ${entities.tables.length} D1 entity tables and ${manifest.objects.length} R2 objects from ${input}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
