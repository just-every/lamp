import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const SESSION_ID = "01J00000000000000000000060";

// Tests deliberately insert a real D1 session row. The production Worker has
// no equivalent route while sign-in remains unconfigured.
export async function insertRealOperatorSession({ persistTo, configPath = "deploy/wrangler.template.toml" } = {}) {
  const statement = [
    "insert into operators (id, email, display_name, is_setup_operator, deactivated_at, created_at, updated_at)",
    "values ('01J00000000000000000000001', 'operator@example.test', 'Contract Operator', 1, null, '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')",
    "on conflict(id) do update set deactivated_at = null, updated_at = excluded.updated_at;",
    "insert into sessions (id, operator_id, expires_at, created_at, updated_at)",
    "values ('01J00000000000000000000060', '01J00000000000000000000001', '2035-01-01T00:00:00.000Z', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')",
    "on conflict(id) do update set expires_at = excluded.expires_at, updated_at = excluded.updated_at",
  ].join(" ");
  const command = [
    "exec", "wrangler", "d1", "execute", "DB", "--local",
    "--config", configPath,
    ...(persistTo ? ["--persist-to", persistTo] : []),
    "--command", statement,
  ];
  await executeFile("pnpm", command, { cwd: process.cwd() });
  return SESSION_ID;
}
