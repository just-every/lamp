import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The Cloudflare Vite plugin emits the deployable Start Worker at a stable
 * location. Its config is already self-contained: relative client and
 * migration paths are resolved from dist/server, while configPath records the
 * source input for diagnostics. Never rewrite generated build artifacts.
 */
export async function readBuiltWorkerArtifact(distDirectory = "dist") {
  const path = join(distDirectory, "server", "wrangler.json");
  let config;
  try {
    config = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
      throw new Error(`Vite did not emit the Start Worker configuration at ${path}.`);
    }
    throw cause;
  }
  if (config.main !== "index.js" || config.assets?.directory !== "../client" || config.assets?.binding !== "ASSETS") {
    throw new Error("Vite did not emit the expected Start Worker entrypoint and client asset directory.");
  }
  return { path, config };
}
