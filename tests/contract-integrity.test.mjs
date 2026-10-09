// Checks that hold today, with no backend: that CONTRACT.md, BASELINE.md, and
// seed.json agree with each other. These catch duplicate IDs, dangling
// cross-references, unlisted policies, and capabilities that name a clause that
// does not exist — the failure modes a contract acquires while it is being edited.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";

import { assertReleaseMigrationInventory, assertReleaseContractInventory } from "../scripts/release-metadata.mjs";

const contractText = readFileSync(new URL("../CONTRACT.md", import.meta.url), "utf8");
const baselineText = readFileSync(new URL("../BASELINE.md", import.meta.url), "utf8");
const seed = JSON.parse(readFileSync(new URL("../seed.json", import.meta.url), "utf8"));
const release = JSON.parse(readFileSync(new URL("../RELEASE.json", import.meta.url), "utf8"));
const previousRelease = release.previousVersion ? JSON.parse(readFileSync(new URL(`../release-history/${release.previousVersion}.json`, import.meta.url), "utf8")) : undefined;

const CLAUSE_HEADING = /^- \*\*([A-Z][A-Z0-9]*-\d{3}) — (.+?)\.\*\*/gm;
const ID_MENTION = /(?<!BASE-)\b([A-Z][A-Z0-9]*-\d{3})\b/g;

const clauses = [...contractText.matchAll(CLAUSE_HEADING)].map(([, id, title]) => ({ id, title }));
const clauseIds = clauses.map((clause) => clause.id);
const baselineIds = [...baselineText.matchAll(/\*\*(BASE-[A-Z]+-\d{3}) —/g)].map(([, id]) => id);

test("every clause has a unique ID", () => {
  const seen = new Set();
  const duplicates = clauseIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(duplicates, [], `duplicate clause IDs: ${duplicates.join(", ")}`);
});

test("the contract declares at least one clause per area prefix it uses", () => {
  assert.ok(clauseIds.length > 0, "no clauses parsed from CONTRACT.md — the heading format changed");
});

test("no clause uses the reserved BASE- prefix", () => {
  assert.deepEqual(clauseIds.filter((id) => id.startsWith("BASE-")), []);
});

test("every BASE- ID named in the contract exists in BASELINE.md", () => {
  const referenced = [...new Set([...contractText.matchAll(/\b(BASE-[A-Z]+-\d{3})\b/g)].map(([, id]) => id))];
  const missing = referenced.filter((id) => !baselineIds.includes(id));
  assert.deepEqual(missing, [], `named baseline clauses that do not exist: ${missing.join(", ")}`);
});

test("every clause-to-clause reference in the contract resolves", () => {
  const dangling = new Set();
  for (const [, id] of contractText.matchAll(ID_MENTION)) {
    if (id.startsWith("BASE-")) continue;
    if (!clauseIds.includes(id)) dangling.add(id);
  }
  assert.deepEqual([...dangling], [], `references to clauses that do not exist: ${[...dangling].join(", ")}`);
});

test("the header names exactly the clauses that supersede a baseline clause", () => {
  const superseding = clauses
    .filter((clause) => {
      const body = contractText.slice(contractText.indexOf(`**${clause.id} —`));
      const end = body.indexOf("\n- **", 1);
      return /\*\*Supersedes BASE-/.test(end === -1 ? body : body.slice(0, end));
    })
    .map((clause) => clause.id);
  const header = contractText.slice(0, contractText.indexOf("## Scope"));
  const named = [...new Set([...header.matchAll(ID_MENTION)].map(([, id]) => id))].filter((id) => !id.startsWith("BASE-"));
  assert.deepEqual(named.sort(), superseding.sort());
});

test("every clause is claimed by exactly one capability in seed.json", () => {
  const claimed = seed.capabilities.flatMap((capability) => capability.clauses);
  const unknown = claimed.filter((id) => !clauseIds.includes(id));
  assert.deepEqual(unknown, [], `capabilities name clauses that do not exist: ${unknown.join(", ")}`);

  const counts = new Map();
  for (const id of claimed) counts.set(id, (counts.get(id) ?? 0) + 1);
  assert.deepEqual([...counts].filter(([, n]) => n > 1).map(([id]) => id), [], "clause claimed twice");

  const unclaimed = clauseIds.filter((id) => !counts.has(id));
  assert.deepEqual(unclaimed, [], `clauses no capability claims: ${unclaimed.join(", ")}`);
});

// extensionPoints.policies is now a flat array of extension IDs (schema-shaped,
// like events/slots/adapters), not {id, clause} objects — the per-policy link to
// the clause that owns it no longer lives in seed.json. This test still compares
// the same two sets the old two tests did together (the policy IDs CONTRACT.md
// marks with `*Policy: \`id\`` against the policy IDs seed.json declares); a full
// set-equality check here already implies "every declared ID appears somewhere as
// a Policy marker", so the old second test ("...appears in the clause that owns
// it") would be redundant on top of this one and was dropped rather than kept as
// a check that verifies nothing this one doesn't.
test("policy IDs in the contract and seed.json policies are the same set", () => {
  const marked = clauses
    .map((clause) => {
      const body = contractText.slice(contractText.indexOf(`**${clause.id} —`));
      const end = body.indexOf("\n- **", 1);
      const text = end === -1 ? body : body.slice(0, end);
      return text.match(/\*Policy: `([^`]+)`/)?.[1] ?? null;
    })
    .filter((id) => id !== null);
  assert.deepEqual(seed.extensionPoints.policies.slice().sort(), marked.slice().sort());
});

test("the number of policies stays within the extension-surface budget", () => {
  assert.ok(seed.extensionPoints.policies.length <= 8, `${seed.extensionPoints.policies.length} policies; AGENTS.md budgets about eight`);
  assert.ok(seed.extensionPoints.slots.length <= 10, `${seed.extensionPoints.slots.length} slots; AGENTS.md budgets about ten`);
});

test("no clause hedges with should or may where it states a guarantee", () => {
  const hedged = clauses.filter((clause) => {
    const body = contractText.slice(contractText.indexOf(`**${clause.id} —`));
    const end = body.indexOf("\n- **", 1);
    const text = end === -1 ? body : body.slice(0, end);
    return /\b(should|may be able to|as appropriate|where possible|if needed)\b/i.test(text);
  });
  assert.deepEqual(hedged.map((clause) => clause.id), []);
});

// nonGoals is now a plain array of one-sentence strings ("<head clause>: <why>."),
// not {id, title, why} objects. The head is still the portion before the first
// colon (the clause the sentence opens with), narrowed the same way the old
// title-based check narrowed it, in case that head itself carries a comma or an
// "and" list the Out of scope section spells differently.
test("every non-goal in seed.json is named in the contract's Out of scope section", () => {
  const outOfScope = contractText.slice(contractText.indexOf("## Out of scope")).toLowerCase();
  const missing = seed.nonGoals.filter((goal) => {
    const head = goal.toLowerCase().split(":")[0].split(",")[0].split(" and ")[0].trim();
    return !outOfScope.includes(head);
  });
  assert.deepEqual(missing, []);
});

test("every external declares why it is unavoidable and what data it receives", () => {
  for (const external of seed.externals) {
    assert.ok(external.why?.length > 20, `${external.id} has no reason`);
    assert.ok(Array.isArray(external.data) && external.data.length > 0, `${external.id} does not say what data it receives`);
    for (const item of external.data) {
      assert.ok(typeof item === "string" && item.length > 5, `${external.id} has a data item that is not a real fact`);
    }
  }
});

test("every estimated limit is marked as an estimate", () => {
  for (const [name, limit] of Object.entries(seed.limits)) {
    if (name.startsWith("$") || name === "status") continue;
    assert.equal(typeof limit.estimate, "boolean", `limits.${name} does not say whether it is an estimate`);
  }
});

test("the release record has every core migration in apply order and only names real dependencies", () => {
  const migrationIds = readdirSync(new URL("../migrations/core/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort();
  assertReleaseMigrationInventory(release, migrationIds, previousRelease);
  assert.throws(
    () => assertReleaseMigrationInventory({ ...release, migrations: release.migrations.slice(0, -1) }, migrationIds, previousRelease),
    /migrations must exactly match/,
  );
});

test("the release record names every changed contract guarantee relative to the retained previous release", () => {
  assertReleaseContractInventory(release, contractText, previousRelease);
  assert.throws(() => assertReleaseContractInventory(release, contractText.replace("the overall status;", "both overall statuses;"), previousRelease));
});
