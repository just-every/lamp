import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// What a Lamp deploy binds so its /health names the deployment that answered (Base deploymentHealth): the source
// commit, a fingerprint of the built Worker and client files, and Cloudflare's version metadata (RER_VERSION, declared
// in the generated wrangler.toml). The deploy passes the first two as plain-text vars and then reads them back.

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort();
}

/** The checkout's commit, marked when tracked files differ from it. */
export function deploySource() {
  const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = git(["rev-parse", "HEAD"]);
  return git(["status", "--porcelain", "--untracked-files=no"]) ? `${commit}+modified` : commit;
}

/** sha256 over every built file's path and content under dist/server and dist/client. */
export async function deployFingerprint(distDirectory = "dist") {
  const hash = createHash("sha256");
  for (const part of ["server", "client"]) {
    for (const file of await files(join(distDirectory, part))) {
      const content = createHash("sha256").update(await readFile(file)).digest("hex");
      hash.update(`${relative(distDirectory, file).split(sep).join("/")}\0${content}\n`);
    }
  }
  return hash.digest("hex");
}

/** The `wrangler deploy` arguments that bind the identity. */
export const identityVars = ({ source, fingerprint }) => ["--var", `RER_DEPLOY_SOURCE:${source}`, "--var", `RER_DEPLOY_FINGERPRINT:${fingerprint}`];

/** Whether a /health body names this deployment. */
export const reportsIdentity = (health, { source, fingerprint }) => health?.deployment?.sourceSha === source
  && health.deployment.fingerprint === fingerprint && typeof health.deployment.versionId === "string" && health.deployment.versionId.length > 0;
