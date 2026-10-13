import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function fixtureProcessEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of [
    "RER_DEV_ORIGIN", "RER_DEV_KEY", "RER_DEV_IDENTITY",
    "AUTH_ORIGIN", "AUTH_LOCAL", "LAMP_LOCAL_ORIGIN", "LAMP_WRANGLER_CONFIG",
    "SESSION_SECRET", "SETUP_OPERATOR_EMAIL",
  ]) delete env[key];
  return {
    ...env,
    LAMP_DISABLE_INSPECTOR: "true",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    ...overrides,
  };
}

// Vite copies an installation's local secrets into dist/server/.dev.vars for
// preview. Compiled-Worker tests retain the real artifact but supply their own
// environment: an explicit --env-file prevents Wrangler loading that sidecar.
// The caller owns the temporary directory and removes it with its fixture state.
export function isolatedWorkerEnvArgs(directory) {
  const path = join(directory, "worker.env");
  writeFileSync(path, "", { mode: 0o600 });
  return ["--env-file", path];
}
