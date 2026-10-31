import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertReleaseMigrationInventory, assertReleaseContractInventory, coreMigrationIds, readReleaseHistory } from "./release-metadata.mjs";
import { checkSchema, validate } from "../schema/json-schema.mjs";

import { validateVendorCatalog } from "./validate-vendor-catalog.mjs";

async function main() {
  await validateVendorCatalog();
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
  const vpatPath = "docs/accessibility/vpat.md";
  let vpat;
  try { vpat = await readFile(vpatPath, "utf8"); }
  catch { throw new Error(`${vpatPath} is required for every release.`); }
  assert.match(vpat, /^Product version:\s*\S+\s*$/m, `${vpatPath} must name its Product version.`);
  assert.equal(/^Product version:\s*(\S+)\s*$/m.exec(vpat)?.[1], release.version, `${vpatPath} must describe RELEASE.json version ${release.version}.`);
  for (const heading of ["Chapter 3 Functional Performance Criteria", "WCAG 2.x Level A", "WCAG 2.x Level AA", "Chapter 5 Software", "Chapter 6 Support Documentation"]) {
    const section = vpat.split(`## ${heading}\n`)[1]?.split(/\n## /)[0];
    assert.ok(section && /^\| Criterion \| Conformance Level \| Remarks and Explanations \|$/m.test(section) && /^\| [^|]+ \| (?:Supports|Partially Supports|Does Not Support|Not Applicable) \| [^|]+ \|$/m.test(section), `${vpatPath} requires the ${heading} conformance table.`);
  }
  const history = await readReleaseHistory(release, releaseSchema);
  assertReleaseMigrationInventory(release, migrationIds, history);
  assertReleaseContractInventory(release, contract, history);
  const tag = process.env.RELEASE_TAG ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
  if (tag) assert.ok(tag === release.version || tag === `v${release.version}`, `Release tag ${tag} must equal ${release.version} or v${release.version}.`);
  console.log(`RELEASE.json validates against the standalone schema for ${release.version}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
