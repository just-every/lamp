import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { deploymentConfig, parseArgs, resourceNames, writeGeneratedWrangler } from "./ops-config.mjs";
import { withDeploymentSecrets } from "./deployment-secrets.mjs";
import { readBuiltWorkerArtifact } from "./build-output.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

async function buildGeneratedWorker(configPath, expected) {
  run("pnpm", ["run", "build"], { env: { ...process.env, LAMP_WRANGLER_CONFIG: configPath } });
  const built = await readBuiltWorkerArtifact();
  const worker = resourceNames(expected.environment).worker;
  if (built.config.name !== worker) throw new Error(`Vite emitted ${built.config.name ?? "an unnamed Worker"} instead of ${worker}.`);
  if (built.config.compatibility_date !== "2026-09-08" || !["nodejs_compat", "global_fetch_strictly_public"].every(flag => built.config.compatibility_flags?.includes(flag))) throw new Error("The compiled Worker configuration did not retain the required Start compatibility settings.");
  if (built.config.vars?.LAMP_PAGE_HOST !== expected.pageHost || built.config.vars?.LAMP_APP_HOST !== expected.appHost || built.config.vars?.MAIL_FROM_ADDRESS !== expected.mailFromAddress) throw new Error("The compiled Worker configuration did not retain the generated deployment bindings.");
  return built.path;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const environment = flags.get("environment") ?? "production";
  const config = deploymentConfig(process.env, environment);
  const restoreArgs = flags.get("restore-from") ? ["--restore-from", flags.get("restore-from")] : [];
  if (flags.get("dry-run")) {
    run("pnpm", ["run", "setup", "--", "--dry-run", "--environment", config.environment, ...restoreArgs]);
    const dryRunConfig = resolve("wrangler.dry-run.toml");
    await writeGeneratedWrangler(dryRunConfig, config, { ...resourceNames(config.environment), databaseId: "00000000-0000-0000-0000-000000000000" });
    try {
      const builtConfig = await buildGeneratedWorker(dryRunConfig, config);
      run("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--config", builtConfig]);
    } finally {
      await rm(dryRunConfig, { force: true });
    }
    console.log("Dry run compiled the generated Start Worker configuration and dist/client assets. No Cloudflare resource or deployment was changed.");
    return;
  }
  run("pnpm", ["run", "setup", "--", "--environment", config.environment, ...restoreArgs]);
  run("pnpm", ["run", "verify"]);
  if (!existsSync("wrangler.toml")) throw new Error("pnpm setup must generate wrangler.toml before deployment.");
  const builtConfig = await buildGeneratedWorker(resolve("wrangler.toml"), config);
  await withDeploymentSecrets(config, async (file) => run("pnpm", ["exec", "wrangler", "deploy", "--config", builtConfig, "--secrets-file", file]));
  const response = await fetch(`https://${config.appHost}/health`, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  const health = await response.json().catch(() => null);
  if (response.status !== 200 || health?.status !== "ok") throw new Error(`Deployment smoke check failed for https://${config.appHost}/health.`);
  // Existing installations and restored archives prime the replica from R2;
  // legacy snapshots without a bundle are rebuilt by the minute scheduler.
  const deadline = Date.now() + 90_000;
  let retained = false;
  do {
    const snapshot = await fetch(`https://${config.pageHost}/api/public/status`, { cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (snapshot.ok && snapshot.headers.get("X-Lamp-Snapshot-Retained") === "true") { retained = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } while (Date.now() < deadline);
  if (!retained) throw new Error("Deployment is live but retained snapshot readiness is unverified; inspect snapshot build failures before accepting this deployment.");
  console.log(`Deployment smoke check passed for ${config.appHost}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
