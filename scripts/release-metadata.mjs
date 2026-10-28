import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validate } from "../schema/json-schema.mjs";
import { clauseIdSource, parseContract } from "../src/base/seed-contract.mjs";

// Early retained releases predate the target/status document. Supply only the
// structural envelope they lack, then use the same parser as current contracts.
// The source snapshot remains unchanged and no historical status is inferred.
const legacyClause = new RegExp(`^-\\s+\\*\\*(${clauseIdSource})\\s+[—–-]\\s+(.+?)\\*\\*`, "gm");

function releaseContract(contract) {
  if (/^## Published clauses\s*$/m.test(contract) || /^## Product target\s*$/m.test(contract)) return parseContract(contract);
  const definitions = [...contract.matchAll(legacyClause)];
  assert.ok(definitions.length, "CONTRACT.md must contain guarantees in the documented clause format.");
  assert.equal(definitions.length, [...contract.matchAll(/^- \*\*/gm)].length, "Malformed contract clause heading.");
  const guarantees = definitions.map(match => {
    const rest = contract.slice(match.index + match[0].length).split(/\n(?=- \*\*|#{1,6} )/, 1)[0];
    return match[0] + rest;
  }).join("\n");
  const rows = definitions.map(([, id, title]) => `| ${id} | ${title.replace(/[.:]$/, "")} | published | missing | | Retained release has no status assessment. |`).join("\n");
  return parseContract(`# Retained release guarantees\n\n## Published clauses\n\n### Retained guarantees\n\n${guarantees}\n\n## Product target\n\n| | |\n| --- | --- |\n| Category | Retained release guarantees |\n| Incumbents a buyer switches from | Recorded in that release |\n| First buyer | Installation adopting that release |\n\n## Status\n\nJudged from the code and tests at commit \`0000000\` (1 January 1970).\n\n| Clause | Title | Kind | Status | Evidence | Gap |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`);
}

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

const historicalMigrationByClause = {
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

// Current clause identities are rekeyed through docs/contract/ID-MAP.json in the
// contract rewrite. Keep the original mapping above for retained first releases.
const migrationByClause = {
  "ACCESS-001": [],
  "ACCESS-002": [],
  "AGENT-001": [],
  "AGENT-002": [],
  "AGENT-003": [],
  "AGENT-004": [],
  "AGENT-005": [],
  "AGENT-006": [],
  "AGENT-007": [],
  "AGENT-008": [],
  "AGENT-009": [],
  "API-001": [],
  "API-002": [],
  "API-003": [],
  "API-004": [],
  "API-005": [],
  "API-006": [],
  "AUD-001": [],
  "AUD-002": [],
  "AUD-003": [],
  "AUD-004": [],
  "AUD-005": [],
  "AUTO-001": [],
  "AUTO-002": [],
  "AUTO-003": [],
  "AUTO-004": [],
  "COMP-001": [
    "0003_public_contract.sql"
  ],
  "COMP-002": [
    "0003_public_contract.sql"
  ],
  "COMP-003": [
    "0003_public_contract.sql"
  ],
  "COMP-004": [
    "0003_public_contract.sql"
  ],
  "COMP-005": [
    "0003_public_contract.sql"
  ],
  "COMP-006": [
    "0003_public_contract.sql"
  ],
  "COMP-007": [
    "0003_public_contract.sql"
  ],
  "COMP-008": [
    "0003_public_contract.sql"
  ],
  "COMP-009": [
    "0003_public_contract.sql"
  ],
  "COMP-010": [
    "0003_public_contract.sql"
  ],
  "DEP-001": [],
  "DEP-002": [],
  "DEP-003": [],
  "DOCS-001": [],
  "DRAFT-001": [
    "0004_publishing_contract.sql"
  ],
  "DRAFT-002": [
    "0004_publishing_contract.sql"
  ],
  "DRAFT-003": [
    "0004_publishing_contract.sql"
  ],
  "DRAFT-004": [
    "0004_publishing_contract.sql"
  ],
  "HIST-001": [
    "0004_publishing_contract.sql"
  ],
  "HIST-002": [
    "0004_publishing_contract.sql"
  ],
  "HIST-003": [
    "0004_publishing_contract.sql"
  ],
  "HIST-004": [
    "0004_publishing_contract.sql"
  ],
  "HIST-005": [
    "0004_publishing_contract.sql"
  ],
  "HIST-006": [
    "0004_publishing_contract.sql"
  ],
  "HIST-007": [
    "0004_publishing_contract.sql"
  ],
  "HIST-008": [
    "0004_publishing_contract.sql"
  ],
  "HIST-009": [
    "0004_publishing_contract.sql"
  ],
  "HIST-010": [
    "0004_publishing_contract.sql"
  ],
  "I18N-001": [],
  "I18N-002": [],
  "I18N-003": [],
  "INCIDENT-001": [],
  "INCIDENT-002": [],
  "INCIDENT-003": [
    "0013_reference_allocations.sql"
  ],
  "INCIDENT-004": [],
  "INCIDENT-005": [],
  "INCIDENT-006": [],
  "INCIDENT-007": [],
  "INCIDENT-008": [],
  "INCIDENT-009": [],
  "INCIDENT-010": [],
  "INCIDENT-011": [],
  "INCIDENT-012": [],
  "INCIDENT-013": [],
  "INCIDENT-014": [],
  "INTAKE-001": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-002": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-003": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-004": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-005": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-006": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-007": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-008": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-009": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-010": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-011": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-012": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-013": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-014": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-015": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-016": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-017": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-018": [
    "0004_publishing_contract.sql"
  ],
  "INTAKE-019": [
    "0004_publishing_contract.sql"
  ],
  "INTEG-001": [],
  "INTEG-002": [],
  "MAINT-001": [
    "0004_publishing_contract.sql",
    "0013_reference_allocations.sql",
    "0058_maintenance_wording.sql"
  ],
  "MAINT-002": [
    "0004_publishing_contract.sql",
    "0058_maintenance_wording.sql"
  ],
  "MAINT-003": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-004": [
    "0004_publishing_contract.sql",
    "0058_maintenance_wording.sql"
  ],
  "MAINT-005": [
    "0004_publishing_contract.sql",
    "0058_maintenance_wording.sql"
  ],
  "MAINT-006": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-007": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-008": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-009": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-010": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-011": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-012": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-013": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-014": [
    "0004_publishing_contract.sql"
  ],
  "MAINT-015": [
    "0004_publishing_contract.sql"
  ],
  "MOBILE-001": [],
  "MOBILE-002": [],
  "MOVE-001": [
    "0056_subscriber_channels_preferences.sql"
  ],
  "MOVE-002": [
    "0025_sorry_import_release.sql"
  ],
  "MOVE-003": [],
  "MOVE-004": [],
  "MOVE-005": [
    "0022_import_maintenance_updates.sql"
  ],
  "MOVE-006": [
    "0025_sorry_import_release.sql"
  ],
  "MOVE-007": [],
  "MOVE-008": [],
  "MOVE-009": [],
  "MOVE-010": [],
  "MOVE-011": [],
  "MOVE-012": [],
  "MOVE-013": [
    "0025_sorry_import_release.sql"
  ],
  "MOVE-014": [],
  "NOTIFY-001": [
    "0005_delivery_contract.sql",
    "0056_subscriber_channels_preferences.sql",
    "0057_component_deliveries.sql"
  ],
  "NOTIFY-002": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-003": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-004": [
    "0005_delivery_contract.sql",
    "0008_provider_callback_recovery.sql"
  ],
  "NOTIFY-005": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-006": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-007": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-008": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-009": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-010": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-011": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-012": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-013": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-014": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-015": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-016": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-017": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-018": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-019": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-020": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-021": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-022": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-023": [
    "0005_delivery_contract.sql"
  ],
  "NOTIFY-024": [
    "0005_delivery_contract.sql"
  ],
  "PAGE-001": [
    "0003_public_contract.sql"
  ],
  "PAGE-002": [
    "0003_public_contract.sql"
  ],
  "PAGE-003": [
    "0003_public_contract.sql"
  ],
  "PAGE-004": [
    "0003_public_contract.sql"
  ],
  "PAGE-005": [
    "0003_public_contract.sql",
    "0006_snapshot_build_ordering.sql"
  ],
  "PAGE-006": [
    "0003_public_contract.sql",
    "0006_snapshot_build_ordering.sql"
  ],
  "PAGE-007": [
    "0003_public_contract.sql",
    "0006_snapshot_build_ordering.sql"
  ],
  "PAGE-008": [
    "0003_public_contract.sql"
  ],
  "PAGE-009": [
    "0003_public_contract.sql"
  ],
  "PAGE-010": [
    "0004_publishing_contract.sql",
    "0006_snapshot_build_ordering.sql",
    "0007_feed_identity.sql"
  ],
  "PAGE-011": [
    "0003_public_contract.sql",
    "0006_snapshot_build_ordering.sql"
  ],
  "PAGE-012": [
    "0003_public_contract.sql"
  ],
  "PAGE-013": [
    "0003_public_contract.sql"
  ],
  "PAGE-014": [
    "0003_public_contract.sql",
    "0006_snapshot_build_ordering.sql"
  ],
  "PAGE-015": [
    "0003_public_contract.sql"
  ],
  "PAGE-016": [
    "0003_public_contract.sql"
  ],
  "PAGE-017": [
    "0003_public_contract.sql"
  ],
  "PAGE-018": [
    "0003_public_contract.sql"
  ],
  "PAGE-019": [
    "0003_public_contract.sql"
  ],
  "PAGE-020": [
    "0003_public_contract.sql"
  ],
  "PAGE-021": [
    "0003_public_contract.sql"
  ],
  "PAGE-022": [
    "0003_public_contract.sql"
  ],
  "PAGE-023": [
    "0003_public_contract.sql"
  ],
  "PAGE-024": [
    "0003_public_contract.sql"
  ],
  "PORT-001": [],
  "PORT-002": [],
  "SETUP-001": [
    "0015_setup_readiness.sql"
  ],
  "SETUP-002": [
    "0016_first_run_setup.sql"
  ],
  "SUB-001": [
    "0005_delivery_contract.sql"
  ],
  "SUB-002": [
    "0005_delivery_contract.sql"
  ],
  "SUB-003": [
    "0005_delivery_contract.sql"
  ],
  "SUB-004": [
    "0005_delivery_contract.sql"
  ],
  "SUB-005": [
    "0005_delivery_contract.sql"
  ],
  "SUB-006": [
    "0005_delivery_contract.sql"
  ],
  "SUB-007": [
    "0005_delivery_contract.sql"
  ],
  "SUB-008": [
    "0005_delivery_contract.sql"
  ],
  "SUB-009": [
    "0005_delivery_contract.sql"
  ],
  "SUB-010": [
    "0005_delivery_contract.sql",
    "0008_provider_callback_recovery.sql"
  ],
  "SUB-011": [
    "0005_delivery_contract.sql"
  ],
  "SUB-012": [
    "0005_delivery_contract.sql"
  ],
  "SUB-013": [
    "0005_delivery_contract.sql"
  ],
  "SUB-014": [
    "0005_delivery_contract.sql"
  ],
  "SUB-015": [
    "0005_delivery_contract.sql"
  ],
  "SUB-016": [
    "0005_delivery_contract.sql"
  ],
  "SUB-017": [
    "0005_delivery_contract.sql"
  ],
  "SUB-018": [
    "0005_delivery_contract.sql"
  ],
  "SUB-019": [
    "0005_delivery_contract.sql"
  ],
  "SUB-020": [
    "0005_delivery_contract.sql"
  ],
  "SUB-021": [
    "0005_delivery_contract.sql"
  ],
  "SUB-022": [
    "0005_delivery_contract.sql"
  ],
  "SUB-023": [
    "0005_delivery_contract.sql"
  ],
  "TEAM-001": [
    "0005_delivery_contract.sql"
  ],
  "TEAM-002": [
    "0005_delivery_contract.sql"
  ],
  "TEAM-003": [
    "0005_delivery_contract.sql"
  ],
  "TEAM-004": [
    "0005_delivery_contract.sql"
  ],
  "TEAM-005": [
    "0005_delivery_contract.sql"
  ],
  "TEAM-006": [
    "0005_delivery_contract.sql"
  ],
  "TEAM-007": [
    "0005_delivery_contract.sql"
  ],
  "THEME-001": [],
  "THEME-002": [],
  "THEME-003": [],
  "UPDATE-001": [
    "0012_resolved_update_time.sql"
  ],
  "UPDATE-002": [],
  "UPDATE-003": [],
  "UPDATE-004": [],
  "UPDATE-005": [
    "0002_one_incident_draft.sql"
  ],
  "UPDATE-006": [
    "0004_publishing_contract.sql"
  ],
  "UPDATE-007": [
    "0004_publishing_contract.sql"
  ],
  "UPDATE-008": [
    "0004_publishing_contract.sql",
    "0005_delivery_contract.sql",
    "0006_snapshot_build_ordering.sql"
  ],
  "UPDATE-009": [],
  "UPDATE-010": [],
  "UPDATE-011": [],
  "UPDATE-012": [],
  "UPDATE-013": [],
  "UPDATE-014": [],
  "UPDATE-015": [],
  "UPDATE-016": [],
  "UPDATE-017": [],
  "UPTIME-001": [
    "0003_public_contract.sql"
  ],
  "UPTIME-002": [
    "0003_public_contract.sql"
  ],
  "UPTIME-003": [
    "0003_public_contract.sql"
  ],
  "UPTIME-004": [
    "0003_public_contract.sql"
  ],
  "UPTIME-005": [
    "0003_public_contract.sql"
  ],
  "UPTIME-006": [
    "0003_public_contract.sql"
  ],
  "UPTIME-007": [
    "0003_public_contract.sql"
  ],
  "UPTIME-008": [
    "0003_public_contract.sql"
  ],
  "UPTIME-009": [
    "0003_public_contract.sql"
  ],
  "UPTIME-010": [
    "0003_public_contract.sql"
  ],
  "UPTIME-011": [
    "0003_public_contract.sql"
  ]
};

export async function coreMigrationIds(directory = "migrations/core") {
  return (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
}

export function contractClauses(contract) {
  const clauses = releaseContract(contract).clauses.filter(({ kind }) => kind === "published");
  assert.ok(clauses.length, "CONTRACT.md must contain published guarantees.");
  return clauses.map(({ id, title, text }) => {
    const body = text.replace(/\s+/g, " ").trim();
    assert.ok(body, `${id} has no guarantee body.`);
    return { id, title, body };
  });
}

export function conciseClauseSummary({ title, body }) {
  const requirement = body.replace(/^\*\*Requirement[.:]\*\*\s*/, "");
  const firstSentence = requirement.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? requirement;
  return `${title}: ${firstSentence}`;
}

export function clauseMigrationIds(id, { historical = false } = {}) {
  const mappings = historical ? historicalMigrationByClause : migrationByClause;
  if (mappings[id]) return mappings[id];
  return migrationByArea[id.split("-", 1)[0]] ?? [];
}

export function releaseContractChanges(contract) {
  const historical = !/^## Published clauses\s*$/m.test(contract);
  return Object.fromEntries(contractClauses(contract).map((clause) => {
    const migrationIds = clauseMigrationIds(clause.id, { historical });
    return [clause.id, {
      change: "added",
      summary: conciseClauseSummary(clause),
      ...(migrationIds.length ? { migrationIds } : {}),
    }];
  }));
}

// Published RELEASE.json files are deltas. Retain the complete chain unchanged,
// with exact CONTRACT.md snapshots alongside it; editorial summaries are not a
// lossless representation of a guarantee's title and complete body.
export async function readReleaseHistory(release, schema, directory = "release-history") {
  const history = [];
  const seen = new Set([release.version]);
  let version = release.previousVersion;
  while (version !== undefined) {
    assert.match(version, /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/, "Invalid history version.");
    assert.ok(!seen.has(version), `Release history cycle at ${version}.`);
    seen.add(version);
    const filename = join(directory, `${version}.json`);
    const previous = JSON.parse(await readFile(filename, "utf8"));
    const errors = validate(schema, previous);
    assert.equal(errors.length, 0, `${filename} does not satisfy the release schema:\n${errors.join("\n")}`);
    assert.equal(previous.version, version, `${filename} must record version ${version}.`);
    const contract = await readFile(join(directory, `${version}.CONTRACT.md`), "utf8");
    history.unshift({ release: previous, contract });
    version = previous.previousVersion;
  }
  // A candidate may not fold an intermediate published delta into itself by
  // pointing at an older record. Every retained record and snapshot belongs to
  // this one predecessor chain; separate release lines are not declared here.
  const retained = await readdir(directory).catch((error) => {
    if (error.code === "ENOENT" && release.previousVersion === undefined) return [];
    throw error;
  });
  const expected = history.flatMap(({ release: previous }) => [
    `${previous.version}.json`, `${previous.version}.CONTRACT.md`,
  ]);
  assert.deepEqual(
    retained.filter((name) => name.endsWith(".json") || name.endsWith(".CONTRACT.md")).sort(),
    expected.sort(),
    "Every retained release record and contract snapshot must belong to the complete predecessor chain.",
  );
  return history;
}

function releaseChain(release, history) {
  const chain = [...history.map((entry) => entry.release), release];
  const versions = new Set();
  let previous;
  for (const record of chain) {
    assert.ok(!versions.has(record.version), `Release history cycle at ${record.version}.`);
    assert.equal(record.previousVersion, previous, "The complete ordered previous release chain must be retained for update validation.");
    versions.add(record.version);
    previous = record.version;
  }
  return chain;
}

export function assertReleaseMigrationInventory(release, migrationIds, history = []) {
  const chain = releaseChain(release, history);
  const released = [];
  for (const record of chain) {
    const ids = record.migrations.map(({ id }) => id);
    if (record === release) {
      assert.deepEqual(ids, migrationIds.slice(released.length), "RELEASE.json migrations must exactly match newly introduced migrations/core in apply order.");
    }
    released.push(...ids);
    assert.equal(new Set(released).size, released.length, "A migration must be introduced exactly once in release history.");
    assert.deepEqual(migrationIds.slice(0, released.length), released, "Released migrations must remain an ordered prefix of the current schema.");
    const known = new Set(released);
    for (const [clause, change] of Object.entries(record.contractChanges)) {
      const dependencies = change.migrationIds ?? [];
      assert.deepEqual([...new Set(dependencies)], dependencies, `${clause} repeats a migration ID.`);
      assert.deepEqual(dependencies.filter((id) => !known.has(id)), [], `${record.version} ${clause} names a migration not available in that release.`);
    }
  }
}

// Inline-code delimiters and whitespace are presentation, not guarantee wording.
const clauseMeaning = ({ title, body }) => JSON.stringify([title, body].map((text) =>
  text.replace(/(`+)([^`]+)\1/g, "$2").replace(/\s+/g, " ").trim()));

export function assertReleaseContractInventory(release, contract, history = []) {
  releaseChain(release, history);
  let previous = new Map();
  const published = new Set();
  for (const entry of [...history, { release, contract }]) {
    const record = entry.release;
    const current = new Map(contractClauses(entry.contract).map((clause) => [clause.id, clause]));
    if (!record.previousVersion) {
      assert.deepEqual(record.contractChanges, releaseContractChanges(entry.contract), "The first release must record every current guarantee.");
    } else {
      for (const [id, clause] of current) {
        const before = previous.get(id);
        if (!before) {
          assert.ok(!published.has(id), `${id} reuses a removed guarantee ID.`);
          assert.equal(record.contractChanges[id]?.change, "added", `${record.version} ${id} was added without an added release entry.`);
        } else if (clauseMeaning(before) !== clauseMeaning(clause)) {
          assert.equal(record.contractChanges[id]?.change, "changed", `${record.version} ${id} changed meaning without a changed release entry.`);
        }
      }
      for (const id of previous.keys()) {
        if (!current.has(id)) assert.equal(record.contractChanges[id]?.change, "removed", `${record.version} ${id} was removed without a release entry.`);
      }
      for (const [id, change] of Object.entries(record.contractChanges)) {
        const expected = !previous.has(id) && current.has(id) ? "added"
          : previous.has(id) && !current.has(id) ? "removed"
          : previous.has(id) && current.has(id) ? "changed" : undefined;
        assert.equal(change.change, expected, `${record.version} ${id} is not a valid ${change.change} clause.`);
      }
    }
    for (const id of current.keys()) published.add(id);
    previous = current;
  }
}
