import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertReleaseMigrationInventory, assertReleaseContractInventory, coreMigrationIds } from "./release-metadata.mjs";
import { checkSchema, validate } from "../schema/json-schema.mjs";

async function main() {
  const [release, seed, packageJson, releaseSchema, seedSchema, migrationIds, contract] = await Promise.all([
    readFile("RELEASE.json", "utf8").then(JSON.parse),
    readFile("seed.json", "utf8").then(JSON.parse),
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("schema/RELEASE.schema.json", "utf8").then(JSON.parse),
    readFile("schema/SEED.schema.json", "utf8").then(JSON.parse),
    coreMigrationIds(),
    readFile("CONTRACT.md", "utf8"),
  ]);
  checkSchema(releaseSchema);
  checkSchema(seedSchema);
  const releaseErrors = validate(releaseSchema, release);
  if (releaseErrors.length) throw new Error(`RELEASE.json does not satisfy schema/RELEASE.schema.json:\n${releaseErrors.map((error) => `- ${error}`).join("\n")}`);
  const seedErrors = validate(seedSchema, seed);
  if (seedErrors.length) throw new Error(`seed.json does not satisfy schema/SEED.schema.json:\n${seedErrors.map((error) => `- ${error}`).join("\n")}`);
  assert.equal(release.version, seed.version, "RELEASE.json and seed.json versions must match.");
  assert.equal(release.version, packageJson.version, "RELEASE.json and package.json versions must match.");
  const previousRelease = release.previousVersion ? JSON.parse(await readFile(`release-history/${release.previousVersion}.json`, "utf8")) : undefined;
  assertReleaseMigrationInventory(release, migrationIds, previousRelease);
  assertReleaseContractInventory(release, contract, previousRelease);
  const tag = process.env.RELEASE_TAG ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
  if (tag) assert.ok(tag === release.version || tag === `v${release.version}`, `Release tag ${tag} must equal ${release.version} or v${release.version}.`);
  console.log(`RELEASE.json validates against the standalone schema for ${release.version}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
