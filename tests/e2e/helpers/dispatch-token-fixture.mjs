import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { getPlatformProxy } from "wrangler";

export async function tokenFixture() {
  const vite = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true } });
  const modules = {
    ...await vite.ssrLoadModule("/src/core/features/deliveries/index.ts"),
    ...await vite.ssrLoadModule("/src/core/features/subscribers/repository.ts"),
    ...await vite.ssrLoadModule("/src/core/features/subscribers/tokens.ts"),
  };
  const statePath = await mkdtemp(join(tmpdir(), "lamp-dispatch-tokens-"));
  let platform;
  const close = async () => { await platform?.dispose(); await vite.close(); await rm(statePath, { recursive: true, force: true }); };
  try {
    execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", statePath, "--config", "wrangler.jsonc"], { maxBuffer: 8 * 1024 * 1024, stdio: "pipe" });
    platform = await getPlatformProxy({ configPath: "wrangler.jsonc", persist: { path: join(statePath, "v3") }, remoteBindings: false });
    const db = platform.env.DB, now = new Date().toISOString();
    await db.batch([
      db.prepare("INSERT INTO operators (id,email,display_name,created_at,updated_at) VALUES ('token-operator','operator@example.test','Token test',?,?)").bind(now, now),
      db.prepare("INSERT INTO incidents (id,reference,title,lifecycle,opened_at,created_by_operator_id,created_at,updated_at) VALUES ('token-incident','INC-1','Token test','Investigating',?,'token-operator',?,?)").bind(now, now, now),
      db.prepare("INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,author_operator_id,created_at,updated_at) VALUES ('token-update','token-incident','Investigating','Readers','Requests fail','','',NULL,?,'token-operator',?,?)").bind(now, now, now),
    ]);
    const seed = async (id, subscriberId = id) => {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO subscribers (id,channel,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES (?,'email',?,'active','all',?,?,?)").bind(subscriberId, `${subscriberId}@example.test`, `test-only-${subscriberId}`, now, now),
        db.prepare("INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,channel,outcome,queued_at,created_at,updated_at) VALUES (?,?,'token-update','email','queued',?,?,?)").bind(id, subscriberId, now, now, now),
      ]);
    };
    return { ...modules, db, now, seed, close };
  } catch (error) { await close(); throw error; }
}
