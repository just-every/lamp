import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readArchive } from "./archive-validation.mjs";
import { assertMailDns } from "./mail-dns.mjs";
import { deploymentOwnership } from "./deployment-ownership.mjs";

import { applyOwnerMigrations } from "./owner-migrations.mjs";
import { deploymentConfig, deploymentRecordPath, parseArgs, resourceNames, setupPageSettingsStatement, writeDeploymentRecord, writeGeneratedWrangler } from "./ops-config.mjs";

function wrangler(args, options = {}) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function d1Id(record) {
  const id = record.uuid ?? record.database_id ?? record.id;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Cloudflare did not return a valid D1 database ID.");
  return id;
}

async function ensureD1(ownership, resources) {
  const row = await ownership.resource('d1', resources.database,
    async () => (await ownership.api.list('/d1/database')).find(row => row.name === resources.database),
    () => ownership.api.request('/d1/database', { method: 'POST', body: { name: resources.database } }));
  return d1Id(row);
}

async function ensureBucket(ownership, resources) {
  await ownership.resource('r2', resources.bucket, async () => {
    try { return await ownership.api.request(`/r2/buckets/${resources.bucket}`); }
    catch (error) { if (error.status === 404) return null; throw error; }
  }, () => ownership.api.request('/r2/buckets', { method: 'POST', body: { name: resources.bucket } }));
}

async function ensureQueue(ownership, resources) {
  await ownership.resource('queues', resources.queue,
    async () => (await ownership.api.list('/queues')).find(row => row.queue_name === resources.queue),
    () => ownership.api.request('/queues', { method: 'POST', body: { queue_name: resources.queue } }));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.get("local")) throw new Error("pnpm setup provisions deployable Cloudflare resources; use pnpm dev for local development.");
  const environment = flags.get("environment") ?? "production";
  const config = deploymentConfig(process.env, environment);
  const names = resourceNames(config.environment, config.resourcePrefix);
  const restoreFrom = flags.get("restore-from");
  if (restoreFrom) await readArchive(resolve(restoreFrom));
  if (flags.get("dry-run")) {
    console.log(JSON.stringify({ environment: config.environment, pageHost: config.pageHost, appHost: config.appHost, pageName: config.pageName, resources: names, dnsValidation: "required during a real setup" }, null, 2));
    return;
  }

  await assertMailDns(config);
  const ownership = deploymentOwnership(config);
  const api = ownership.api;
  if (config.hosting === "workers-dev") {
    const registered = await api.request("/workers/subdomain");
    if (!registered?.subdomain || config.appHost !== `${names.worker}.${registered.subdomain}.workers.dev`) throw new Error("The configured workers.dev hostname does not match this Cloudflare account. Enable its Workers subdomain in Cloudflare, then update LAMP_APP_HOST and LAMP_PAGE_HOST.");
  }
  const databaseId = await ensureD1(ownership, names);
  await ensureBucket(ownership, names);
  await ensureQueue(ownership, names);
  const resources = { ...names, databaseId };
  await writeGeneratedWrangler(resolve("wrangler.toml"), config, resources);
  await writeDeploymentRecord(deploymentRecordPath(config.environment), { environment: config.environment, accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim(), pageHost: config.pageHost, appHost: config.appHost, resources, configuredAt: new Date().toISOString() });
  if (restoreFrom) {
    const imported = spawnSync(process.execPath, ["scripts/import.mjs", "--remote", "--environment", config.environment, "--from", resolve(restoreFrom)], { stdio: "inherit" });
    if (imported.status !== 0) throw new Error("Restore did not complete. The Worker has not been deployed; preserve the archive and use a fresh environment for recovery.");
  }
  wrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.toml"]);
  await applyOwnerMigrations("wrangler.toml", ["--remote"]);
  wrangler(["d1", "execute", "DB", "--remote", "--config", "wrangler.toml", "--command", `${setupPageSettingsStatement(config)}`]);
  if (!existsSync("wrangler.toml")) throw new Error("Setup did not generate wrangler.toml.");
  console.log(`Provisioned ${names.worker}; migrations and page settings are initialized. Claim the owner with SETUP_TOKEN after deployment.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
