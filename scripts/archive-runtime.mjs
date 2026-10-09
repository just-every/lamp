import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getPlatformProxy } from "wrangler";

import { deploymentRecordPath, readDeploymentRecord, renderRemoteArchiveWranglerToml } from "./ops-config.mjs";

function persistence(flags) {
  return resolve(flags.get("persist-to") ?? "deploy/.wrangler/state");
}

function localConfig(flags) {
  return flags.get("config") ?? "deploy/wrangler.template.toml";
}

function archiveEnvironment(flags) {
  const environment = flags.get("environment") ?? "production";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(environment)) throw new Error("Archive environment must contain lowercase letters, digits, and hyphens.");
  return environment;
}

async function remoteConfig(flags) {
  if (flags.get("config")) throw new Error("Remote archives use the generated owner deployment record; --config is only supported for local archives.");
  const environment = archiveEnvironment(flags);
  let record;
  try {
    record = await readDeploymentRecord(deploymentRecordPath(environment));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Remote archive requires the deployment record written by pnpm setup for ${environment}: ${reason}`);
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required for remote archive operations. Wrangler then uses the owner API token or OAuth profile at command runtime.");
  if (record.accountId && record.accountId !== accountId) throw new Error(`CLOUDFLARE_ACCOUNT_ID does not match the ${environment} deployment record.`);
  const path = resolve(".seed", "deployment", `${environment}.archive-proxy-${process.pid}.toml`);
  await mkdir(resolve(".seed", "deployment"), { recursive: true });
  await writeFile(path, renderRemoteArchiveWranglerToml({ accountId, ...record.resources, migrationsDir: resolve("migrations", "core") }), "utf8");
  return path;
}

export async function openArchivePlatform(flags) {
  if (flags.get("local") && flags.get("remote")) throw new Error("Choose exactly one of --local or --remote.");
  if (!flags.get("remote")) {
    const platform = await getPlatformProxy({
      configPath: localConfig(flags),
      remoteBindings: false,
      // Wrangler's local CLI writes a v3 directory below --persist-to. Its Node
      // binding accepts that v3 directory itself, so both sides address one state.
      persist: { path: join(persistence(flags), "v3") },
    });
    return { platform, configPath: localConfig(flags), dispose: () => platform.dispose() };
  }
  const configPath = await remoteConfig(flags);
  let platform;
  try {
    platform = await getPlatformProxy({ configPath, remoteBindings: true });
  } catch (cause) {
    await rm(configPath, { force: true });
    throw cause;
  }
  return {
    platform,
    configPath,
    async dispose({ keepConfig = false } = {}) {
      await platform.dispose();
      if (!keepConfig) await rm(configPath, { force: true });
    },
  };
}

export function archivePersistence(flags) {
  return persistence(flags);
}
