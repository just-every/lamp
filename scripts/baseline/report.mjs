import { statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { baselineId } from "./catalog.mjs";

const defaultAxePath = "tests/e2e/accessibility.test.mjs";
const root = resolve();
const baselineDirectory = resolve(root, "tests/baseline/e2e-baseline");

function normalized(path) {
  return relative(root, resolve(root, path)).replaceAll("\\", "/");
}

function isExistingTestFile(path) {
  try { return statSync(resolve(root, path)).isFile() && path.endsWith(".test.mjs"); }
  catch { return false; }
}

export function allowedProvenance(id, path) {
  const candidate = normalized(path);
  const absolute = resolve(root, candidate);
  const withinBaselineDirectory = relative(baselineDirectory, absolute);
  if (withinBaselineDirectory && !withinBaselineDirectory.startsWith("../") && !withinBaselineDirectory.includes("/../") && isExistingTestFile(candidate)) return true;
  return id === "BASE-PUBLIC-003" && candidate === defaultAxePath && isExistingTestFile(candidate);
}

export function baselineReport(catalog, executions) {
  const issues = [];
  const results = new Map([...catalog.keys()].map((id) => [id, []]));
  for (const execution of executions) {
    const path = normalized(execution.path ?? "");
    if (execution.exitCode !== 0) issues.push(`${path || "unknown test file"} exited ${execution.exitCode}.`);
    for (const result of execution.results ?? []) {
      const id = result.id?.toUpperCase();
      if (!id || !baselineId.test(id)) {
        issues.push(`${path || "pathless result"} reported an invalid baseline clause ID ${String(result.id)}.`);
        continue;
      }
      if (!catalog.has(id)) {
        issues.push(`${path || "pathless result"} reported unknown baseline clause ${id}.`);
        continue;
      }
      if (!allowedProvenance(id, path)) {
        issues.push(`[baseline:${id}] must come from tests/baseline/e2e-baseline (BASE-PUBLIC-003 may come from ${defaultAxePath}); got ${path || "no path"}.`);
        continue;
      }
      results.get(id).push({ ...result, path });
    }
  }

  const status = {};
  for (const [id, clause] of catalog) {
    const entries = results.get(id);
    const bad = entries.filter((entry) => entry.status !== "passed");
    const state = !entries.length ? "broken" : bad.length ? "failed" : "satisfied";
    if (!entries.length) issues.push(`${id} has no executed baseline result.`);
    if (bad.length) issues.push(`${id} has nonpassing executed result(s): ${bad.map((entry) => `${entry.status} in ${entry.path}`).join(", ")}.`);
    status[id] = {
      state,
      title: clause.title,
      baselineLine: clause.line,
      supersededBy: clause.supersededBy,
      results: entries,
    };
  }
  return { status, issues, success: !issues.length };
}
