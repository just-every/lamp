import assert from "node:assert/strict";

import { readBaselineCatalog } from "./catalog.mjs";
import { baselineReport } from "./report.mjs";

const catalog = await readBaselineCatalog();
const valid = "tests/baseline/e2e-baseline/core-baseline.test.mjs";

{
  const report = baselineReport(catalog, [{ path: valid, exitCode: 0, results: [...catalog.keys()].filter((id) => id !== "BASE-PUBLIC-003").map((id) => ({ id, status: "passed" })) }, { path: "tests/e2e/accessibility.test.mjs", exitCode: 0, results: [{ id: "BASE-PUBLIC-003", status: "passed" }] }]);
  assert.equal(report.success, true);
  assert.equal(report.status["BASE-ACCESS-003"].state, "satisfied");
  assert.deepEqual(report.status["BASE-ACCESS-003"].supersededBy, [{ contractId: "PAGE-008", scope: "those paths only", line: 20 }]);
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
