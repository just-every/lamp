import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const contractText = readFileSync("CONTRACT.md", "utf8");
const clauses = [...contractText.matchAll(/^- \*\*([A-Z][A-Z0-9]*-\d{3}) —/gm)].map((match) => match[1]);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts;
const clausePattern = /^[A-Z][A-Z0-9]*-\d{3}$/;

function verifiedTestFiles(scriptName, seen = new Set()) {
  if (seen.has(scriptName)) return [];
  seen.add(scriptName);
  const command = scripts[scriptName];
  if (typeof command !== "string") throw new Error(`verify references missing script ${scriptName}.`);
  const files = [...command.matchAll(/\b(tests\/[\w./-]+\.mjs)\b/g)].map((match) => match[1]);
  for (const match of command.matchAll(/\bpnpm\s+run\s+([\w:-]+)/g)) files.push(...verifiedTestFiles(match[1], seen));
  return files;
}

function uncommented(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "));
}

function taggedCalls(source) {
  const code = uncommented(source);
  const calls = [];
  for (const match of code.matchAll(/\bcontract\s*\(\s*(["'])([A-Z][A-Z0-9]*-\d{3})\1\s*(,|\))/g)) {
    calls.push({ id: match[2], name: "contract", executable: match[3] === ",", line: code.slice(0, match.index).split("\n").length });
  }
  for (const match of code.matchAll(/\btest(?:\.(skip|todo))?\s*\(\s*(["'])([A-Z][A-Z0-9]*-\d{3})(?:\s|—|:)[^\n"']*\2\s*(,|\))/g)) {
    const name = match[1] ? `test.${match[1]}` : "test";
    calls.push({ id: match[3], name, executable: name !== "test.todo" && match[4] === ",", line: code.slice(0, match.index).split("\n").length });
  }
  return calls;
}

const verifiedFiles = [...new Set(verifiedTestFiles("verify:app"))];
const behaviorFiles = verifiedFiles.filter((file) => file.startsWith("tests/e2e/"));
const tagged = new Map();
const invalid = [];
for (const file of behaviorFiles) {
  for (const call of taggedCalls(readFileSync(file, "utf8"))) {
    const id = call.id;
    if (!clausePattern.test(id)) continue;
    if (!call.executable || call.name === "test.skip" || call.name === "test.todo") invalid.push(`${id} is not executable at ${file}:${call.line}`);
    const entries = tagged.get(id) ?? [];
    entries.push({ file, line: call.line });
    tagged.set(id, entries);
  }
}

const unknown = [...tagged.keys()].filter((id) => !clauses.includes(id));
const missing = clauses.filter((id) => !tagged.has(id));

test("every product contract clause has an executable tagged behavior test invoked by verify", () => {
  assert.deepEqual(unknown, [], `Unknown contract test tags: ${unknown.join(", ")}`);
  assert.deepEqual(invalid, [], `Non-executable contract test tags: ${invalid.join("; ")}`);
  assert.deepEqual(missing, [], `Missing executed contract behavior tests: ${missing.join(", ")}`);
});
