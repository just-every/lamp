import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

test("production operator assets use the declared app-assets namespace", async () => {
  const files = await readdir("dist/client/app-assets");
  assert.ok(files.some((file) => file.endsWith(".js")), "expected a built operator script in dist/client/app-assets");
  assert.ok(files.some((file) => file.endsWith(".css")), "expected a built operator stylesheet in dist/client/app-assets");
});

test("the Vite production output uses the generated Start server configuration", async () => {
  const config = JSON.parse(await readFile("dist/server/wrangler.json", "utf8"));
  assert.equal(config.main, "index.js");
  assert.equal(config.assets?.directory, "../client");
  assert.equal(config.assets?.binding, "ASSETS");
  assert.equal(config.assets?.run_worker_first, true);
  assert.ok(config.compatibility_flags?.includes("nodejs_compat"));
  assert.ok(config.compatibility_flags?.includes("global_fetch_strictly_public"));
  const worker = await readFile("dist/server/index.js", "utf8");
  assert.doesNotMatch(worker, /import\.meta\.env/);
  assert.doesNotMatch(worker, /developmentOperatorShell|src\/core\/worker/);
});
