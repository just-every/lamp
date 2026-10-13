import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The local wrangler.jsonc as an object with absolute paths, so a test can write
// a derived configuration (extra vars or bindings) anywhere as JSON.
export function localWranglerConfig(change = (config) => config) {
  const config = JSON.parse(readFileSync(resolve("wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  config.vars = {...config.vars, ...Object.fromEntries(['AUTH_ORIGIN','AUTH_LOCAL','SESSION_SECRET','SETUP_OPERATOR_EMAIL'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))};
  config.main = resolve(config.main);
  for (const database of config.d1_databases) database.migrations_dir = resolve(database.migrations_dir);
  return JSON.stringify(change(config), null, 2);
}

// Wrangler and the Vite plugin load `.dev.vars` from the directory holding the config they are given, and its values
// override the config's own vars. A fixture config therefore goes in a fresh directory of its own, never the repo root,
// so a checkout's local secrets and settings (written by `rer setup`) cannot steer the test. Call `write()` again to
// replace the config in place; `cleanup()` removes the directory.
export function isolatedWranglerConfig(change) {
  const directory = mkdtempSync(join(tmpdir(), "lamp-fixture-config-"));
  const path = join(directory, "wrangler.json");
  const write = (next = change) => writeFileSync(path, localWranglerConfig(next), { mode: 0o600 });
  write();
  return { path, write, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
