import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { ownerMigrationFiles } from "./owner-migrations.mjs";

// RER Managed installs Lamp through Platform's migration runner, which keeps its
// own trusted ledger, rer_migrations(name, sha256, applied_at): one row per file
// the delivery artifact carries, named with that directory's delivery prefix,
// plus the per-installation page initializer Lamp's plan generates
// (management/integration/plan.ts), whose bytes hold that installation's page
// settings. The ledger is installation authority, never owner data: archives
// never carry it and restore never writes it. Only this exact name is the ledger.
export const platformLedger = "rer_migrations";
export const pageInitializer = "setup-initial-page.sql";
const delivery = JSON.parse(await readFile(new URL("./delivery/base/packaging.json", import.meta.url), "utf8")).artifact.specInputs;
// Platform names each delivered migrations/core file with this prefix.
export const coreMigrationPrefix = delivery.migrationPrefix;
const ownerPrefix = delivery.extraMigrationDirectories.find((directory) => directory.path === "migrations/ext").prefix;

const byName = (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

async function deliveredMigrations() {
  const core = (await readdir("migrations/core")).filter((file) => file.endsWith(".sql"));
  return [
    ...(await Promise.all(core.map(async (file) => ({ name: delivery.migrationPrefix + file, sha256: await digest(join("migrations/core", file)) })))),
    ...(await Promise.all((await ownerMigrationFiles()).map(async (file) => ({ name: ownerPrefix + file, sha256: await digest(join("migrations/ext", file)) })))),
  ].sort(byName);
}

const mismatch = () => new Error("The RER Managed migration ledger (rer_migrations) does not list exactly this revision's migrations with their file hashes. Use the source revision that installed this database, and finish any interrupted release, before exporting or restoring.");

// Every delivered file once with its exact hash, and nothing else but the page
// initializer: no changed hash, unknown or missing file, or interrupted-release
// progress row ('<file>#<start>-<end>').
export async function assertPlatformLedger(rows) {
  const expected = await deliveredMigrations();
  const recorded = rows.filter((row) => !(row?.name === pageInitializer && /^[0-9a-f]{64}$/.test(row.sha256))).map((row) => ({ name: row?.name, sha256: row?.sha256 })).sort(byName);
  if (recorded.length !== expected.length || recorded.some((row, index) => row.name !== expected[index].name || row.sha256 !== expected[index].sha256)) throw mismatch();
}

// Returns null for a database without Platform's ledger.
export async function platformLedgerRows(database) {
  if (!(await database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(platformLedger).first())) return null;
  try {
    return (await database.prepare(`SELECT name, sha256 FROM ${platformLedger}`).all()).results;
  } catch {
    throw mismatch();
  }
}

// Platform has already applied this revision to a Managed destination, so it
// is new when its owner has never claimed it and it holds exactly the archive's
// tables: an unknown table on either side, including any other rer_ name, stops.
export async function assertNewManagedDestination(database, destinationTables, archiveTables) {
  await assertPlatformLedger(await platformLedgerRows(database));
  const destination = destinationTables.filter((name) => name !== platformLedger).sort();
  const archived = archiveTables.map((table) => table.name).sort();
  const differ = [...destination.filter((name) => !archived.includes(name)), ...archived.filter((name) => !destination.includes(name))];
  if (differ.length) throw new Error(`The RER Managed destination's tables differ from the archive (${differ.join(", ")}). Restore with the source revision that created this archive into a new installation.`);
  if (await database.prepare("SELECT 1 FROM oa_bootstrap UNION ALL SELECT 1 FROM operators LIMIT 1").first()) throw new Error("Import requires a new RER Managed installation whose owner has not signed in; create a new installation instead of overwriting existing records.");
}
