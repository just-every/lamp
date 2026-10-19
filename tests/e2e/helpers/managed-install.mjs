import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const delivery = JSON.parse(await readFile(new URL("../../../scripts/delivery/base/packaging.json", import.meta.url), "utf8")).artifact.specInputs;
const recipe = JSON.parse(await readFile(new URL("../../../management/integration/recipe.json", import.meta.url), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (value) => `'${value.replaceAll("'", "''")}'`;

// A database as RER Managed leaves it: Platform's runner applies every file the
// delivery artifact carries (directory prefix + file name) and records each in
// its own ledger with Platform's exact DDL, then runs Lamp's page initializer
// with this installation's values. There is no Wrangler d1_migrations ledger.
export async function installManaged(statePath, { config, pageName }) {
  const files = (await readdir("migrations/core")).filter((file) => file.endsWith(".sql")).sort();
  const migrations = await Promise.all(files.map(async (file) => {
    const bytes = await readFile(join("migrations/core", file));
    return { name: delivery.migrationPrefix + file, sha256: sha256(bytes), sql: bytes.toString("utf8") };
  }));
  const values = { RER_RECIPE_NAME: pageName, RER_RECIPE_TAGLINE: `${pageName} status`, RER_RECIPE_TIMESTAMP: new Date().toISOString() };
  const initializer = recipe.migrations.at(-1).sql.replace(/RER_RECIPE_NAME|RER_RECIPE_TAGLINE|RER_RECIPE_TIMESTAMP/g, (key) => values[key].replaceAll("'", "''"));
  migrations.push({ name: recipe.migrations.at(-1).name, sha256: sha256(initializer), sql: initializer });
  const script = ["CREATE TABLE rer_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"];
  for (const migration of migrations) script.push(migration.sql, `INSERT INTO rer_migrations(name, sha256) VALUES (${text(migration.name)}, ${text(migration.sha256)});`);
  await mkdir(statePath, { recursive: true });
  const file = join(statePath, `managed-${randomUUID()}.sql`);
  await writeFile(file, script.join("\n"));
  try {
    execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", statePath, "--config", config, "--file", file], { stdio: "pipe" });
  } finally { await rm(file, { force: true }); }
}
