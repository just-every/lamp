import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validate } from "../schema/json-schema.mjs";

const CLAUSE = /^- \*\*([A-Z][A-Z0-9]*-\d{3}) — (.+?)\.\*\*[ \t]*(.*)$/gm;

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
  const matches = [...contract.matchAll(CLAUSE)];
  assert.ok(matches.length, "CONTRACT.md must contain guarantees in the documented clause format.");
  assert.equal(matches.length, [...contract.matchAll(/^- \*\*/gm)].length, "Malformed contract clause heading.");
  const seen = new Set();
  return matches.map((match) => {
    const [, id, title, firstLine] = match;
    assert.ok(!seen.has(id), `Duplicate contract clause ${id}.`);
    seen.add(id);
    const rest = contract.slice(match.index + match[0].length).split(/\n(?=- \*\*|#{1,6} )/, 1)[0];
    const body = `${firstLine}${rest}`.replace(/\s+/g, " ").trim();
    assert.ok(body, `${id} has no guarantee body.`);
    return { id, title, body };
  });
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
