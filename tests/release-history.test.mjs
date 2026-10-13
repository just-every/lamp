import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { join } from "node:path";
import { releaseContractChanges } from "../scripts/release-metadata.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = join(root, "scripts/validate-release.mjs");
const firstContract = "# Contract\n\n- **GUAR-001 — Record.** Records persist. Deletion requires confirmation.\n- **GUAR-002 — Export.** Owners can export. Exports include every record.\n";
const secondContract = firstContract.replace("Deletion requires confirmation.", "Deletion requires two confirmations.");
const currentContract = `${secondContract}- **GUAR-003 — Audit.** Every deletion is recorded.\n`;
const migration = (id) => ({ id, buyerSteps: "Apply before starting the release." });
const delta = (change) => ({ change, summary: "An editorial summary, independent of the clause's first sentence.", ...(change !== "added" ? { was: "The prior guarantee." } : {}), ...(change === "changed" ? { now: "The revised guarantee." } : {}) });
const record = (version, previousVersion, contractChanges, migrations) => ({
  version, ...(previousVersion ? { previousVersion } : {}), contractChanges,
  migrations: migrations.map(migration), extensionPointChanges: [], breaking: false,
  agentUpdateInstructions: "Preserve existing owner data and apply the listed migrations.",
});

test("release CLI validates a three-release delta chain and rejects missing history, migrations and guarantees", async () => {
  const directory = await mkdtemp(join(root, ".release-history-test-"));
  const env = {};
  const seed = JSON.parse(await readFile(join(root, "seed.json"), "utf8"));
  const schemas = await Promise.all(["RELEASE", "SEED"].map(async (name) => [name, await readFile(join(root, `schema/${name}.schema.json`), "utf8")]));
  const json = (path, data) => writeFile(join(directory, path), JSON.stringify(data));
  const modify = async (path, mutate) => {
    const data = JSON.parse(await readFile(join(directory, path), "utf8"));
    mutate(data);
    await json(path, data);
  };
  const rewrite = async (path, before, after) => {
    const text = await readFile(join(directory, path), "utf8");
    assert.ok(text.includes(before));
    await writeFile(join(directory, path), text.replace(before, after));
  };
  const baseline = async () => {
    await rm(directory, { recursive: true, force: true });
    for (const path of ["schema", "release-history", "migrations/core"]) await mkdir(join(directory, path), { recursive: true });
    for (const [name, text] of schemas) await writeFile(join(directory, `schema/${name}.schema.json`), text);
    await json("seed.json", { ...seed, version: "2.2.0" });
    await json("package.json", { version: "2.2.0" });
    await json("release-history/2.0.0.json", record("2.0.0", undefined, releaseContractChanges(firstContract), ["0001_initial.sql"]));
    await json("release-history/2.1.0.json", record("2.1.0", "2.0.0", { "GUAR-001": delta("changed") }, ["0002_confirmations.sql"]));
    await json("RELEASE.json", record("2.2.0", "2.1.0", { "GUAR-003": delta("added") }, ["0003_audit.sql"]));
    await writeFile(join(directory, "release-history/2.0.0.CONTRACT.md"), firstContract);
    await writeFile(join(directory, "release-history/2.1.0.CONTRACT.md"), secondContract);
    await writeFile(join(directory, "CONTRACT.md"), currentContract);
    for (const id of ["0001_initial.sql", "0002_confirmations.sql", "0003_audit.sql"]) await writeFile(join(directory, "migrations/core", id), "-- Fixture migration\n");
  };
  const run = () => spawnSync(process.execPath, [command], { cwd: directory, env, encoding: "utf8", timeout: 10_000 });
  const assertExit = (result, status, message) => {
    assert.equal(result.error, undefined, `${message}: ${result.error?.message ?? result.stderr}`);
    assert.equal(result.signal, null, `${message}: ${result.signal ?? result.stderr}`);
    assert.equal(result.status, status, `${message}: ${result.stderr}`);
  };
  const firstRelease = () => json("RELEASE.json", record("2.2.0", undefined, releaseContractChanges(currentContract), ["0001_initial.sql", "0002_confirmations.sql", "0003_audit.sql"]));
  const scenarios = [
    ["missing old migration", () => rm(join(directory, "migrations/core/0001_initial.sql"))],
    ["missing current migration declaration", () => modify("RELEASE.json", (r) => { r.migrations = []; })],
    ["missing ancestor record", () => rm(join(directory, "release-history/2.0.0.json"))],
    ["missing historical contract", () => rm(join(directory, "release-history/2.0.0.CONTRACT.md"))],
    ["skipped retained predecessor", async () => {
      const skipped = JSON.parse(await readFile(join(directory, "release-history/2.1.0.json"), "utf8"));
      await modify("RELEASE.json", (r) => {
        r.previousVersion = skipped.previousVersion;
        r.contractChanges = { ...skipped.contractChanges, ...r.contractChanges };
        r.migrations = [...skipped.migrations, ...r.migrations];
      });
    }],
    ["first release with retained history", firstRelease],
    ["orphan historical contract", () => writeFile(join(directory, "release-history/2.0.1.CONTRACT.md"), firstContract)],
    ["malformed historical record", () => modify("release-history/2.0.0.json", (r) => { r.migrations = "invalid"; })],
    ["invalid historical JSON", () => writeFile(join(directory, "release-history/2.0.0.json"), "{")],
    ["history version mismatch", () => modify("release-history/2.0.0.json", (r) => { r.version = "9.0.0"; })],
    ["cyclic history", () => modify("release-history/2.0.0.json", (r) => { r.previousVersion = "2.2.0"; })],
    ["unsafe history version", () => modify("release-history/2.0.0.json", (r) => { r.previousVersion = "../outside"; })],
    ["missing historical change", () => modify("release-history/2.1.0.json", (r) => { r.contractChanges = {}; })],
    ["lost first-release guarantee", () => modify("release-history/2.0.0.json", (r) => { delete r.contractChanges["GUAR-002"]; })],
    ["undeclared later sentence", () => rewrite("CONTRACT.md", "Exports include every record.", "Exports omit archived records.")],
    ["undeclared wrapped continuation", () => rewrite("CONTRACT.md", "Exports include every record.", "Exports include every record.\n  Archived records are excluded.")],
    ["undeclared title", () => rewrite("CONTRACT.md", "Export.**", "Partial export.**")],
    ["undeclared removal", () => rewrite("CONTRACT.md", "- **GUAR-002 — Export.** Owners can export. Exports include every record.\n", "")],
    ["wrong delta kind", () => modify("RELEASE.json", (r) => { r.contractChanges["GUAR-003"] = delta("changed"); })],
    ["duplicate historical migration", () => modify("release-history/2.1.0.json", (r) => { r.migrations.push(migration("0001_initial.sql")); })],
    ["future migration dependency", () => modify("release-history/2.1.0.json", (r) => { r.contractChanges["GUAR-001"].migrationIds = ["0003_audit.sql"]; })],
    ["unparseable clause", () => rewrite("CONTRACT.md", "GUAR-002 — Export.**", "GUAR-002: Export.**")],
    ["reused removed clause ID", async () => {
      await rewrite("release-history/2.1.0.CONTRACT.md", "- **GUAR-002 — Export.** Owners can export. Exports include every record.\n", "");
      await modify("release-history/2.1.0.json", (r) => { r.contractChanges["GUAR-002"] = delta("removed"); });
      await modify("RELEASE.json", (r) => { r.contractChanges["GUAR-002"] = delta("added"); });
    }],
  ];
  try {
    await baseline();
    let result = run();
    assertExit(result, 0, "three-release chain");
    // Formatting changes preserve wording even across a retained historical delta.
    await rewrite("release-history/2.1.0.CONTRACT.md", "Owners can export.", "Owners can `export`.");
    result = run();
    assertExit(result, 0, "formatting-only historical edit");
    await baseline();
    await rewrite("CONTRACT.md", "- **GUAR-002 — Export.** Owners can export. Exports include every record.\n", "");
    await modify("RELEASE.json", (r) => { r.contractChanges["GUAR-002"] = delta("removed"); });
    result = run();
    assertExit(result, 0, "declared guarantee removal");
    await firstRelease();
    await writeFile(join(directory, "CONTRACT.md"), currentContract);
    await rm(join(directory, "release-history"), { recursive: true });
    result = run();
    assertExit(result, 0, "first release without history");
    for (const [name, mutate] of scenarios) {
      await baseline();
      await mutate();
      result = run();
      assertExit(result, 1, name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
