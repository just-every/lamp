import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { applyOwnerMigrations } from "./owner-migrations.mjs";

const persistence = resolve(process.env.LAMP_WORKERS_STATE_PATH ?? "deploy/.wrangler/state");

try {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", persistence, "--config", "deploy/wrangler.template.toml"], { stdio: "inherit" });
  await applyOwnerMigrations("deploy/wrangler.template.toml", ["--local", "--persist-to", persistence]);
} catch {
  process.exit(1);
}
