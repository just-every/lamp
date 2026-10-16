import { readdir } from "node:fs/promises";
import { join } from "node:path";

// Wrangler's local settings files. The Cloudflare Vite plugin copies .dev.vars
// into dist/server for `vite preview`; a build bound for Cloudflare must never
// carry the owner's local keys, so no build writes one and the deploy refuses
// any output that holds one.
const localSecretFile = /^\.(dev\.vars|env)(\..+)?$/;

/** Vite plugin: drops a local settings file from every bundle before it is written. */
export function localSecretsStayLocal() {
  return {
    name: "lamp:local-secrets-stay-local",
    enforce: "post",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) if (localSecretFile.test(fileName.split("/").at(-1))) delete bundle[fileName];
    },
  };
}

/** Throws, naming the files, when a build output folder holds a local settings file. */
export async function assertNoLocalSecretFiles(directory = "dist") {
  const found = [];
  async function walk(folder) {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) { if (error?.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (localSecretFile.test(entry.name)) found.push(path);
    }
  }
  await walk(directory);
  if (found.length) throw new Error(`The build output holds local settings files (${found.join(", ")}). Remove them and build again; local keys never reach a deployment.`);
}
