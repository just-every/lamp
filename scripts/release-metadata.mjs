import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";

const CLAUSE = /^- \*\*([A-Z][A-Z0-9]*-\d{3}) — (.+?)\.\*\*\s+(.+)$/gm;

const migrationByArea = {
  PAGE: ["0003_public_contract.sql"],
  COMP: ["0003_public_contract.sql"],
  UPTIME: ["0003_public_contract.sql"],
  INCIDENT: [],
  UPDATE: [],
  MAINT: ["0004_publishing_contract.sql"],
  SUB: ["0005_delivery_contract.sql"],
  NOTIFY: ["0005_delivery_contract.sql"],
  INTAKE: ["0004_publishing_contract.sql"],
  DRAFT: ["0004_publishing_contract.sql"],
  TEAM: ["0005_delivery_contract.sql"],
  HIST: ["0004_publishing_contract.sql"],
};

const migrationByClause = {
  "PAGE-005": ["0003_public_contract.sql", "0006_snapshot_build_ordering.sql"],
  "PAGE-006": ["0003_public_contract.sql", "0006_snapshot_build_ordering.sql"],
  "PAGE-007": ["0003_public_contract.sql", "0006_snapshot_build_ordering.sql"],
  "PAGE-010": ["0004_publishing_contract.sql", "0006_snapshot_build_ordering.sql", "0007_feed_identity.sql"],
  "PAGE-011": ["0003_public_contract.sql", "0006_snapshot_build_ordering.sql"],
  "PAGE-014": ["0003_public_contract.sql", "0006_snapshot_build_ordering.sql"],
  "UPDATE-005": ["0002_one_incident_draft.sql"],
  "UPDATE-006": ["0004_publishing_contract.sql"],
  "UPDATE-007": ["0004_publishing_contract.sql"],
  "UPDATE-008": ["0004_publishing_contract.sql", "0005_delivery_contract.sql", "0006_snapshot_build_ordering.sql"],
  "SUB-010": ["0005_delivery_contract.sql", "0008_provider_callback_recovery.sql"],
  "NOTIFY-004": ["0005_delivery_contract.sql", "0008_provider_callback_recovery.sql"],
};

export async function coreMigrationIds(directory = "migrations/core") {
  return (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
}

export function contractClauses(contract) {
  return [...contract.matchAll(CLAUSE)].map(([, id, title, body]) => ({ id, title, body: body.replace(/\s+/g, " ").trim() }));
}

export function conciseClauseSummary({ title, body }) {
  const firstSentence = body.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? body;
  return `${title}: ${firstSentence}`;
}

export function clauseMigrationIds(id) {
  if (migrationByClause[id]) return migrationByClause[id];
  return migrationByArea[id.split("-", 1)[0]] ?? [];
}

export function releaseContractChanges(contract) {
  return Object.fromEntries(contractClauses(contract).map((clause) => {
    const migrationIds = clauseMigrationIds(clause.id);
    return [clause.id, {
      change: "added",
      summary: conciseClauseSummary(clause),
      ...(migrationIds.length ? { migrationIds } : {}),
    }];
  }));
}

export function assertReleaseMigrationInventory(release, migrationIds, previousRelease) {
  if (release.previousVersion) assert.equal(previousRelease?.version, release.previousVersion, "The previous release record must be retained for update validation.");
  const previousIds = previousRelease?.migrations.map(({ id }) => id) ?? [];
  assert.deepEqual(migrationIds.slice(0, previousIds.length), previousIds, "Released migrations must remain an ordered prefix of the current schema.");
  assert.deepEqual(
    release.migrations.map(({ id }) => id),
    migrationIds.slice(previousIds.length),
    "RELEASE.json migrations must exactly match newly introduced migrations/core in apply order.",
  );

  const known = new Set(migrationIds);
  for (const [clause, change] of Object.entries(release.contractChanges)) {
    const ids = change.migrationIds ?? [];
    assert.deepEqual([...new Set(ids)], ids, `${clause} repeats a migration ID.`);
    assert.deepEqual(ids.filter((id) => !known.has(id)), [], `${clause} names a migration that is not in migrations/core.`);
  }
}

export function assertReleaseContractInventory(release, contract, previousRelease) {
  const current = releaseContractChanges(contract);
  if (!release.previousVersion) return assert.deepEqual(release.contractChanges, current, "The first release must record every current guarantee.");
  // The retained first release gives this update a complete previous contract.
  assert.equal(previousRelease?.version, release.previousVersion);
  for (const [id, clause] of Object.entries(current)) {
    const previous = previousRelease.contractChanges[id];
    if (previous?.summary !== clause.summary) assert.ok(release.contractChanges[id], `${id} changed meaning without a release entry.`);
  }
  for (const id of Object.keys(previousRelease.contractChanges)) {
    if (!current[id]) assert.equal(release.contractChanges[id]?.change, "removed", `${id} was removed without a release entry.`);
  }
  for (const [id, change] of Object.entries(release.contractChanges)) assert.ok(current[id] || change.change === "removed", `${id} is not a current or removed clause.`);
}
