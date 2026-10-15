import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { readBaselineCatalog } from "./catalog.mjs";
import { baselineReport } from "./report.mjs";

await import("./reporter-probes.mjs");

const root = process.cwd();
const baselineDirectory = "tests/baseline/e2e-baseline";
const reportPath = process.env.LAMP_BASELINE_REPORT ?? join(tmpdir(), "lamp-baseline-report.json");

async function baselineFiles() {
  const entries = await readdir(baselineDirectory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs")).map((entry) => join(baselineDirectory, entry.name)).sort();
}

function parseTap(output) {
  const results = [];
  const line = /^(not )?ok \d+ - (\[baseline:[^\n]+)/gm;
  for (const match of output.matchAll(line)) {
    const status = match[1] ? "failed" : /# (?:SKIP|TODO)\b/i.test(match[2]) ? "skipped" : "passed";
    for (const id of match[2].matchAll(/\[baseline:([^\]]+)\]/g)) results.push({ id: id[1], status });
  }
  return results;
}

function run(file) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", file], { cwd: root, env: { ...process.env, LAMP_DISABLE_INSPECTOR: "true" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveRun({ path: relative(root, join(root, file)), exitCode: signal ? 1 : code ?? 1, results: parseTap(output) }));
  });
}

const catalog = await readBaselineCatalog();
const files = await baselineFiles();
if (!files.length) throw new Error(`No baseline test files found in ${baselineDirectory}.`);
// The Axe test is a real baseline case owned by the accessibility lane. It is
// explicitly admitted by report.mjs and never globbed from arbitrary e2e.
files.push("tests/e2e/accessibility.test.mjs");
const executions = [];
for (const file of files) executions.push(await run(file));
const report = baselineReport(catalog, executions);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify({ ...report, executions }, null, 2)}\n`);
process.stdout.write(`baseline report: ${reportPath}\n`);
if (!report.success) {
  for (const issue of report.issues) process.stderr.write(`baseline: ${issue}\n`);
  process.exitCode = 1;
}
