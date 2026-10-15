import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readArchive } from "./archive-validation.mjs";
import { assertMailDns } from "./mail-dns.mjs";

import { applyOwnerMigrations } from "./owner-migrations.mjs";
import { deploymentConfig, deploymentRecordPath, parseArgs, resourceNames, setupPageSettingsStatement, writeDeploymentRecord, writeGeneratedWrangler } from "./ops-config.mjs";

function wrangler(args, options = {}) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function parseJson(output, description) {
  const first = Math.min(...[output.indexOf("["), output.indexOf("{")].filter((index) => index >= 0));
  if (!Number.isFinite(first)) throw new Error(`${description} did not return JSON.`);
  return JSON.parse(output.slice(first));
}

function d1Id(record) {
  const id = record.uuid ?? record.database_id ?? record.id;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Cloudflare did not return a valid D1 database ID.");
  return id;
}

async function ensureD1(api, resources) {
  const databases = parseJson(wrangler(["d1", "list", "--json"]), "wrangler d1 list");
  const existing = databases.find((database) => database.name === resources.database);
  if (existing) return d1Id(existing);
  const created = await api.request("/d1/database", { method: "POST", body: JSON.stringify({ name: resources.database }) });
  if (created.name !== resources.database) throw new Error("Cloudflare returned a different D1 database name than requested.");
  return d1Id(created);
}

function cloudflareApi() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required to provision R2 and Queues through the Cloudflare API.");
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required to provision R2 and Queues through the Cloudflare API.");
  async function request(path, init = {}) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      const errors = Array.isArray(payload?.errors) ? payload.errors.map((error) => error.message ?? JSON.stringify(error)).join("; ") : response.statusText;
      const failure = new Error(`Cloudflare API ${init.method ?? "GET"} ${path} failed (${response.status}): ${errors}`);
      Object.assign(failure, { status: response.status });
      throw failure;
    }
    return payload.result;
  }
  return { request };
}

async function ensureBucket(api, resources) {
  try {
    await api.request(`/r2/buckets/${encodeURIComponent(resources.bucket)}`);
  } catch (cause) {
    if (!(cause instanceof Error) || !Object.hasOwn(cause, "status") || cause.status !== 404) throw cause;
    await api.request("/r2/buckets", { method: "POST", body: JSON.stringify({ name: resources.bucket }) });
  }
}

async function ensureQueue(api, resources) {
  // Wrangler 4.127 exposes only a human-formatted queue list. The underlying
  // documented endpoint accepts a name filter and page, so setup stays
  // machine-readable and never parses CLI tables.
  for (let page = 1; page <= 100; page += 1) {
    const queues = await api.request(`/queues?${new URLSearchParams({ name: resources.queue, page: String(page) })}`);
    if (!Array.isArray(queues) || queues.length === 0) break;
    if (queues.some((queue) => queue.queue_name === resources.queue)) return;
  }
  await api.request("/queues", { method: "POST", body: JSON.stringify({ queue_name: resources.queue }) });
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
  const api = cloudflareApi();
  if (config.hosting === "workers-dev") {
    const registered = await api.request("/workers/subdomain");
    if (!registered?.subdomain || config.appHost !== `${names.worker}.${registered.subdomain}.workers.dev`) throw new Error("The configured workers.dev hostname does not match this Cloudflare account. Enable its Workers subdomain in Cloudflare, then update LAMP_APP_HOST and LAMP_PAGE_HOST.");
  }
  const databaseId = await ensureD1(api, names);
  await ensureBucket(api, names);
  await ensureQueue(api, names);
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
