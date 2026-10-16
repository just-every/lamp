import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { deploymentConfig, mailEnvironmentNames, mailEnvironmentSources, parseArgs, resourceNames, writeGeneratedWrangler } from "./ops-config.mjs";
import { keptSecrets, replacedSecrets, withDeploymentSecrets } from "./deployment-secrets.mjs";
import { withPublicWorkerConfig } from "./native-public-worker.mjs";
import { readOperations } from "./operations.mjs";
import { dryRunInputFailure } from "./deploy-preflight.mjs";
import { readBuiltWorkerArtifact } from "./build-output.mjs";
import { deployFingerprint, deploySource, identityVars, reportsIdentity } from "./deployment-identity.mjs";
import { deploymentOwnership } from './deployment-ownership.mjs';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

async function buildGeneratedWorker(configPath, expected) {
  run("pnpm", ["run", "build:app"], { env: { ...process.env, LAMP_WRANGLER_CONFIG: configPath } });
  const built = await readBuiltWorkerArtifact();
  const worker = resourceNames(expected.environment, expected.resourcePrefix).worker;
  if (built.config.name !== worker) throw new Error(`Vite emitted ${built.config.name ?? "an unnamed Worker"} instead of ${worker}.`);
  if (built.config.compatibility_date !== "2026-09-08" || !["nodejs_compat", "global_fetch_strictly_public"].every(flag => built.config.compatibility_flags?.includes(flag))) throw new Error("The compiled Worker configuration did not retain the required Start compatibility settings.");
  if (built.config.vars?.LAMP_PAGE_HOST !== expected.pageHost || built.config.vars?.LAMP_APP_HOST !== expected.appHost || built.config.vars?.MAIL_FROM_ADDRESS !== expected.mailFromAddress) throw new Error("The compiled Worker configuration did not retain the generated deployment bindings.");
  if (expected.mailProvider === "rer" && (built.config.vars?.MAIL_FROM !== expected.mailFromAddress || built.config.vars?.MAIL_RELAY_URL !== expected.mailRelayUrl)) throw new Error("The compiled Worker configuration did not retain managed mail bindings.");
  return built.path;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const environment = flags.get("environment") ?? "production";
  const { descriptor } = await readOperations(process.cwd());
  descriptor.requiredEnvironment = [...new Set([...descriptor.requiredEnvironment, ...mailEnvironmentNames(process.env)])];
  descriptor.environmentSources = { ...descriptor.environmentSources, ...mailEnvironmentSources };
  const dryRunFailure = flags.get("dry-run") ? dryRunInputFailure(descriptor, process.env) : null;
  if (dryRunFailure) {
    console.error(dryRunFailure);
    process.exitCode = 1;
    return;
  }
  const missing = descriptor.requiredEnvironment.filter(name => !process.env[name]?.trim());
  if (!flags.get("dry-run") && missing.length) {
    // Names only: a value never reaches the terminal.
    console.error(`Missing deployment inputs: ${missing.join(", ")}. Read OPERATIONS.md, set them, then run rer deploy again.`);
    process.exitCode = 1;
    return;
  }
  const config = deploymentConfig(process.env, environment);
  const names = resourceNames(config.environment, config.resourcePrefix);
  const restoreArgs = flags.get("restore-from") ? ["--restore-from", flags.get("restore-from")] : [];
  if (flags.get("dry-run")) {
    run("pnpm", ["run", "setup:cloudflare", "--", "--dry-run", "--environment", config.environment, ...restoreArgs]);
    const dryRunConfig = resolve("wrangler.dry-run.toml");
    await writeGeneratedWrangler(dryRunConfig, config, { ...resourceNames(config.environment, config.resourcePrefix), databaseId: "00000000-0000-0000-0000-000000000000" });
    try {
      const builtConfig = await buildGeneratedWorker(dryRunConfig, config);
      const identity = identityVars({ source: deploySource(), fingerprint: await deployFingerprint() });
      run("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--config", builtConfig, ...identity]);
      if (config.hosting === "workers-dev") await withPublicWorkerConfig(builtConfig, names, path => run("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--config", path, ...identity]));
    } finally {
      await rm(dryRunConfig, { force: true });
    }
    console.log("Dry run compiled the generated Start Worker configuration and dist/client assets. No Cloudflare resource or deployment was changed.");
    return;
  }
  run("pnpm", ["run", "setup:cloudflare", "--", "--environment", config.environment, ...restoreArgs]);
  if (!existsSync("wrangler.toml")) throw new Error("pnpm setup must generate wrangler.toml before deployment.");
  const builtConfig = await buildGeneratedWorker(resolve("wrangler.toml"), config);
  const identity = { source: deploySource(), fingerprint: await deployFingerprint() };
  const ownership = deploymentOwnership(config);
  const replace = replacedSecrets();
  // Each Worker keeps the signing secrets it already holds (deployment-secrets.mjs).
  const upload = async (page, deploy) => {
    const kept = keptSecrets(await ownership.heldSecrets(page), replace);
    if (kept.length) console.log(`Kept ${kept.join(", ")} on ${page ? names.publicWorker : names.worker}, so existing subscriber links and operator sessions keep working.`);
    await withDeploymentSecrets(config, kept, file => ownership.upload(page, identity, () => deploy(file)));
  };
  await upload(false, file => run("pnpm", ["exec", "wrangler", "deploy", "--config", builtConfig, "--secrets-file", file, ...identityVars(identity)]));
  if (config.hosting === "workers-dev") await withPublicWorkerConfig(builtConfig, names, path => upload(true, file => run("pnpm", ["exec", "wrangler", "deploy", "--config", path, "--secrets-file", file, ...identityVars(identity)])));
  // A new workers.dev Worker can answer 404 for a few seconds after its first upload.
  let response, health;
  for (const healthDeadline = Date.now() + 90_000; ; await new Promise((resolve) => setTimeout(resolve, 3_000))) {
    response = await fetch(`https://${config.appHost}/health`, { cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error" }).catch(() => null);
    health = await response?.json().catch(() => null);
    if ((response?.status === 200 && health?.status === "ok" && reportsIdentity(health, identity)) || Date.now() > healthDeadline) break;
  }
  if (response?.status !== 200 || health?.status !== "ok") throw new Error(`Deployment smoke check failed for https://${config.appHost}/health (HTTP ${response?.status ?? "unreachable"} after 90 seconds).`);
  if (!reportsIdentity(health, identity)) throw new Error(`https://${config.appHost}/health does not name this deployment (source ${identity.source}); another version may be serving.`);
  // Existing installations and restored archives prime the replica from R2;
  // legacy snapshots without a bundle are rebuilt by the minute scheduler.
  // Identity is claimed through Base after its secret bindings are deployed.
  // Existing stores reject bootstrap without changing their owner or settings.
  // The CLI hook claims in its own process so rer observes and links that
  // exchange. Standalone deploy:cloudflare still completes its own bootstrap.
  if (!flags.get("result-file")) {
    const claimed = await fetch(`https://${config.appHost}/auth/bootstrap`, {method:'POST',redirect:'manual',headers:{Origin:`https://${config.appHost}`,'Content-Type':'application/json'},body:JSON.stringify({token:config.setupToken,displayName:config.setupOperatorDisplayName})});
    await claimed.body?.cancel();
    if (![303,409].includes(claimed.status)) throw new Error('Owner bootstrap failed after deployment. Inspect the auth configuration.');
  }
  const deadline = Date.now() + 90_000;
  let retained = false;
  do {
    const snapshot = await fetch(`https://${config.pageHost}/api/public/status`, { cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (snapshot.ok && snapshot.headers.get("X-Lamp-Snapshot-Retained") === "true") { retained = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  } while (Date.now() < deadline);
  if (!retained) throw new Error("Deployment is live but retained snapshot readiness is unverified; inspect snapshot build failures before accepting this deployment.");
  if (flags.get("result-file")) await writeFile(resolve(flags.get("result-file")), JSON.stringify({ deployed: true, environment, origin: `https://${config.appHost}` }) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Deployment smoke check passed for ${config.appHost}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
