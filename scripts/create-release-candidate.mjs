import { access, readFile, writeFile } from "node:fs/promises";

import { coreMigrationIds, releaseContractChanges } from "./release-metadata.mjs";

try {
  await access("RELEASE.json");
  throw new Error("RELEASE.json already exists. Update its version, previousVersion, migration and meaning changes explicitly; the first-release generator must not overwrite a retained release record.");
} catch (cause) { if (cause.code !== "ENOENT") throw cause; }

const contract = await readFile("CONTRACT.md", "utf8");
const seed = JSON.parse(await readFile("seed.json", "utf8"));
const kinds = [
  ["contribution", seed.extensionPoints.contributions],
  ["policy", seed.extensionPoints.policies],
  ["event", seed.extensionPoints.events],
  ["slot", seed.extensionPoints.slots],
  ["adapter", seed.extensionPoints.adapters],
];
const migrationIds = await coreMigrationIds();
const release = {
  version: seed.version,
  date: new Date().toISOString().slice(0, 10),
  contractChanges: releaseContractChanges(contract),
  extensionPointChanges: kinds.flatMap(([kind, ids]) => ids.map((id) => ({ id, kind, change: "added", summary: `Initial Lamp 1.0 ${kind} extension point.` }))),
  migrations: migrationIds.map((id) => ({ id, buyerSteps: "Apply with the release before starting the updated Worker." })),
  breaking: false,
  agentUpdateInstructions: "This is Lamp’s first release. Preserve the R2 public snapshot architecture and shared incident renderer, apply every listed core migration before starting the Worker, generate deployment configuration with pnpm setup, and run pnpm verify before adopting the release.",
};
await writeFile("RELEASE.json", `${JSON.stringify(release, null, 2)}\n`, "utf8");
console.log(`Created RELEASE.json candidate for ${release.version} with ${Object.keys(release.contractChanges).length} contract additions.`);
