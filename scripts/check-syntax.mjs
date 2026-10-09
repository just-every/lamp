// Parses first-party JavaScript and Node scripts. The TypeScript application
// and Worker are checked separately by `pnpm run typecheck`.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "scripts", "tests"];
const SKIP = new Set(["node_modules", ".git"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(js|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((root) => {
  try { return walk(root); } catch { return []; }
});

if (files.length === 0) {
  console.error("check-syntax: no modules found; the check would pass vacuously.");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failed++;
    console.error(`FAIL ${file}\n${error.stderr?.toString() ?? error.message}`);
  }
}

console.log(`check-syntax: ${files.length - failed}/${files.length} modules parsed`);
process.exit(failed === 0 ? 0 : 1);
