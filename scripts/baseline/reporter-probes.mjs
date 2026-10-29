import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { readBaselineCatalog } from "./catalog.mjs";
import { baselineReport } from "./report.mjs";
import { parseContract, plainText } from "../../src/base/seed-contract.mjs";

const catalog = await readBaselineCatalog();
const contractLines = (await readFile("CONTRACT.md", "utf8")).split(/\r?\n/);
const valid = "tests/baseline/e2e-baseline/core-baseline.test.mjs";

{
  const report = baselineReport(catalog, [{ path: valid, exitCode: 0, results: [...catalog.keys()].filter((id) => id !== "BASE-PUBLIC-003").map((id) => ({ id, status: "passed" })) }, { path: "tests/e2e/accessibility.test.mjs", exitCode: 0, results: [{ id: "BASE-PUBLIC-003", status: "passed" }] }]);
  assert.equal(report.success, true);
  assert.equal(report.status["BASE-ACCESS-003"].state, "satisfied");
  const [supersession] = report.status["BASE-ACCESS-003"].supersededBy;
  assert.equal(report.status["BASE-ACCESS-003"].supersededBy.length, 1);
  assert.equal(supersession.contractId, "PAGE-008");
  assert.equal(supersession.scope, "those paths only");
  assert.ok(Number.isInteger(supersession.line) && supersession.line > 0 && supersession.line <= contractLines.length);
  const referencedClause = contractLines[supersession.line - 1];
  const pageReadRule = parseContract(contractLines.join("\n")).clauses.find(clause => clause.id === supersession.contractId);
  assert.ok(pageReadRule);
  assert.match(plainText(pageReadRule.text), /Supersedes BASE-ACCESS-003 for those paths only\./);
  assert.match(plainText(referencedClause), /Supersedes BASE-ACCESS-003 for those paths only\./);
}
{
  const report = baselineReport(catalog, [{ path: "tests/e2e/public-contract.test.mjs", exitCode: 0, results: [{ id: "BASE-ACCESS-001", status: "passed" }] }]);
  assert.equal(report.status["BASE-ACCESS-001"].state, "broken");
  assert.ok(report.issues.some((issue) => issue.includes("must come from tests/baseline/e2e-baseline")));
}
{
  const report = baselineReport(catalog, [{ path: "tests/baseline/e2e-baseline/../../e2e/public-contract.test.mjs", exitCode: 0, results: [{ id: "BASE-ACCESS-001", status: "passed" }] }]);
  assert.equal(report.status["BASE-ACCESS-001"].state, "broken");
  assert.ok(report.issues.some((issue) => issue.includes("must come from tests/baseline/e2e-baseline")));
}
{
  const report = baselineReport(catalog, [{ path: valid, exitCode: 0, results: [{ id: "BASE-ACCESS-001", status: "skipped" }, { id: "BASE-NOT-999", status: "passed" }] }]);
  assert.equal(report.status["BASE-ACCESS-001"].state, "failed");
  assert.ok(report.issues.some((issue) => issue.includes("unknown baseline clause BASE-NOT-999")));
}
{
  const report = baselineReport(catalog, [{ path: valid, exitCode: 1, results: [{ id: "BASE-ACCESS-001", status: "passed" }] }]);
  assert.equal(report.success, false);
  assert.ok(report.issues.some((issue) => issue.includes("exited 1")));
}
{
  const report = baselineReport(catalog, [{ path: valid, exitCode: 0, results: [] }]);
  assert.equal(report.status["BASE-ACCESS-001"].state, "broken");
  assert.ok(report.issues.some((issue) => issue.includes("no executed baseline result")));
}
process.stdout.write("baseline reporter probes: passed\n");
