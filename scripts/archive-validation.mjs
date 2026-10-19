import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { ownerMigrationFiles } from "./owner-migrations.mjs";
import { assertPlatformLedger, platformLedger } from "./platform-ledger.mjs";

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function filename(value) {
  if (typeof value !== "string" || !value || basename(value) !== value || value === "." || value === ".." || value.includes("\\")) throw new Error("Archive files must be plain filenames within the export directory.");
  return value;
}

// Validate the entire archive before opening a destination or applying a migration.
export async function readArchive(input) {
  const manifest = JSON.parse(await readFile(join(input, "manifest.json"), "utf8"));
  if (manifest.format !== "lamp-export.v1" || !Array.isArray(manifest.objects) || !Array.isArray(manifest.migrations)) throw new Error("The import manifest is not a Lamp v1 export.");
  const entitiesBytes = await readFile(join(input, filename(manifest.database?.file)));
  if (digest(entitiesBytes) !== manifest.database.sha256) throw new Error("The exported D1 entity checksum does not match its manifest.");
  const entities = JSON.parse(entitiesBytes);
  if (entities.version !== 1 || !Array.isArray(entities.tables)) throw new Error("The export has an unsupported D1 entity format.");
  const names = new Set();
  for (const table of entities.tables) {
    if (typeof table?.name !== "string" || !table.name || names.has(table.name) || !Array.isArray(table.dependsOn) || table.dependsOn.some((name) => typeof name !== "string") || !Array.isArray(table.rows)) throw new Error("The export has an invalid or duplicate D1 table record.");
    names.add(table.name);
    let columns;
    for (const row of table.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Invalid row in ${table.name}.`);
      const keys = Object.keys(row).sort().join("\0");
      columns ??= keys;
      if (!keys || keys !== columns) throw new Error(`Inconsistent columns in ${table.name}.`);
    }
  }
  // Lamp 1.8.0 and earlier archived a Managed installation's ledger as data.
  // It must still describe this revision; restore never writes it.
  const ledger = entities.tables.find((table) => table.name === platformLedger);
  if (ledger) {
    await assertPlatformLedger(ledger.rows);
    entities.tables = entities.tables.filter((table) => table !== ledger);
  }
  const migrations = new Set();
  const available = (await readdir("migrations/core")).filter((name) => name.endsWith(".sql")).sort();
  if (manifest.migrations.length !== available.length || manifest.migrations.some((migration, index) => migration.file !== available[index])) throw new Error("Restore requires the archive's exact core migration inventory. Use the source revision that created this archive, restore it, then update normally.");
  for (const migration of manifest.migrations) {
    const file = filename(migration.file);
    if (migrations.has(file) || !file.endsWith(".sql")) throw new Error("The archive migration inventory is invalid.");
    migrations.add(file);
    const current = await readFile(join("migrations/core", file));
    if (digest(current) !== migration.sha256) throw new Error(`Migration ${file} differs from the exported schema. Restore with the source revision that created this archive, then update normally.`);
  }
  if (manifest.ownerMigrations !== undefined && !Array.isArray(manifest.ownerMigrations)) throw new Error("The archive owner migration inventory is invalid.");
  const ownerFiles = await ownerMigrationFiles();
  const archivedOwnerFiles = (manifest.ownerMigrations ?? []).map((migration) => migration.file);
  if (ownerFiles.length !== archivedOwnerFiles.length || ownerFiles.some((file, index) => file !== archivedOwnerFiles[index])) throw new Error("Restore requires the archive's exact owner migration inventory. Restore with the matching owner source revision before updating.");
  for (const migration of manifest.ownerMigrations ?? []) {
    const file = filename(migration.file);
    const current = await readFile(join("migrations/ext", file));
    if (digest(current) !== migration.sha256) throw new Error(`Owner migration ${file} differs from this archive. Restore from the owner's matching source revision.`);
  }
  const keys = new Set();
  for (const object of manifest.objects) {
    if (typeof object.key !== "string" || !object.key || keys.has(object.key)) throw new Error("The archive contains an invalid or duplicate R2 key.");
    keys.add(object.key);
    const bytes = await readFile(join(input, "objects", filename(object.file)));
    if (digest(bytes) !== object.sha256 || bytes.byteLength !== object.size) throw new Error(`The exported object checksum or size does not match for ${object.key}.`);
  }
  return { manifest, entities };
}
