import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { parseArgs } from "./ops-config.mjs";
import { openArchivePlatform } from "./archive-runtime.mjs";
import { ownerMigrationFiles } from "./owner-migrations.mjs";
import { assertPlatformLedger, platformLedger, platformLedgerRows } from "./platform-ledger.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function quotedIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

async function listAll(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function tableNames(database) {
  const result = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND lower(substr(name, 1, 7)) <> 'sqlite_' AND lower(substr(name, 1, 4)) <> '_cf_' AND name NOT IN ('d1_migrations', 'lamp_ext_migrations', ?) ORDER BY name").bind(platformLedger).all();
  return result.results.map((row) => String(row.name));
}

async function dependencies(database, table) {
  const result = await database.prepare(`PRAGMA foreign_key_list(${quotedIdentifier(table)})`).all();
  return result.results.map((row) => String(row.table));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const output = resolve(flags.get("out") ?? `exports/lamp-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
  await mkdir(output, { recursive: true, mode: 0o700 });
  if ((await readdir(output)).length) throw new Error("Export requires an empty output directory so an interrupted or older archive cannot be mistaken for this backup.");
  await mkdir(join(output, "objects"), { mode: 0o700 });
  const archive = await openArchivePlatform(flags);
  const { platform } = archive;
  try {
    const ledger = await platformLedgerRows(platform.env.DB);
    if (ledger) await assertPlatformLedger(ledger);
    const tables = await tableNames(platform.env.DB);
    const entities = [];
    // D1 batch executes these reads in one transaction, so related records
    // cannot be captured on opposite sides of a concurrent publication.
    const ordering = await Promise.all(tables.map(async (name) => {
      const columns = (await platform.env.DB.prepare(`PRAGMA table_info(${quotedIdentifier(name)})`).all()).results;
      const keys = columns.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk);
      return keys.length ? keys.map((column) => quotedIdentifier(column.name)).join(", ") : "rowid";
    }));
    const snapshot = tables.length ? await platform.env.DB.batch(tables.map((name, index) => platform.env.DB.prepare(`SELECT * FROM ${quotedIdentifier(name)} ORDER BY ${ordering[index]}`))) : [];
    for (const [index, name] of tables.entries()) {
      entities.push({ name, dependsOn: await dependencies(platform.env.DB, name), rows: snapshot[index].results.map(row => name === "public_metrics" ? { ...row, sealed_credentials: null, pull_lease_until: null, pull_after: 0 } : name === "alert_sources" && "responder_sealed_credentials" in row ? { ...row, responder_sealed_credentials: null } : row) });
    }
    const entitiesPath = join(output, "entities.json");
    const entitiesBytes = Buffer.from(`${JSON.stringify({ version: 1, tables: entities }, null, 2)}\n`);
    await writeFile(entitiesPath, entitiesBytes, { mode: 0o600 });

    const objects = [];
    for (const object of await listAll(platform.env.SNAPSHOTS)) {
      const source = await platform.env.SNAPSHOTS.get(object.key);
      if (!source) throw new Error(`R2 object ${object.key} disappeared while exporting.`);
      const bytes = new Uint8Array(await source.arrayBuffer());
      const file = `${objects.length.toString().padStart(6, "0")}-${encodeURIComponent(object.key)}`;
      await writeFile(join(output, "objects", file), bytes, { mode: 0o600 });
      objects.push({ key: object.key, file, size: bytes.byteLength, sha256: digest(bytes), contentType: source.httpMetadata?.contentType ?? null, httpMetadata: source.httpMetadata ?? {}, customMetadata: source.customMetadata ?? {} });
    }
    const migrations = await Promise.all((await readdir("migrations/core")).filter((name) => name.endsWith(".sql")).sort().map(async (file) => ({ file, sha256: digest(await readFile(join("migrations/core", file))) })));
    const ownerMigrations = await Promise.all((await ownerMigrationFiles()).map(async (file) => ({ file, sha256: digest(await readFile(join("migrations/ext", file))) })));
    const manifest = {
      format: "lamp-export.v1",
      exportedAt: new Date().toISOString(),
      database: { file: basename(entitiesPath), sha256: digest(entitiesBytes), tables: tables.length },
      migrations,
      ownerMigrations,
      objects,
    };
    await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(`Exported ${tables.length} D1 entities and ${objects.length} R2 objects to ${output}.`);
  } finally {
    await archive.dispose();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
