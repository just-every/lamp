import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { unstable_getMiniflareWorkerOptions } from "wrangler";

const require = createRequire(import.meta.url), wrangler = createRequire(require.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = wrangler("miniflare"), { build } = wrangler("esbuild");

export async function preparePortableAudit(db) {
  const createdAt = new Date(Date.now() - 73 * 3600000).toISOString();
  const id = "01J00000000000000000000211", destination = "synthetic-lamp-211@example.test";
  await db.prepare("INSERT INTO subscribers(id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES(?,'email',?,?,'pending','all','synthetic-lamp-212',?,?)")
    .bind(id, destination, destination, createdAt, createdAt).run();
  await db.prepare("INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,created_at,updated_at) VALUES('synthetic-lamp-213',?,'confirm','synthetic-lamp-214',?,?)")
    .bind(id, createdAt, createdAt).run();
  return { id, destination, createdAt };
}

/** Run the real scheduled Worker on the native import's persisted D1/R2 files. */
export async function assertPortableAudit({ target, expected, origin, cookie, bindings }) {
  const built = await build({
    entryPoints: ["tests/e2e/helpers/follow-ups-worker.ts"], bundle: true, format: "esm", platform: "browser", write: false,
    external: ["cloudflare:workers", "node:*"], define: { "import.meta.env.DEV": "false" },
    plugins: [{ name: "assets", setup(builder) {
      builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split("?")[0]), namespace: args.path.endsWith("?raw") ? "raw" : "inline" }));
      for (const namespace of ["raw", "inline"]) builder.onLoad({ filter: /.*/, namespace }, async args => ({
        contents: `export default ${JSON.stringify(namespace === "raw" ? await readFile(args.path, "utf8") : "data:application/octet-stream;base64," + (await readFile(args.path)).toString("base64"))}`, loader: "js",
      }));
    } }],
  });
  const options = unstable_getMiniflareWorkerOptions(join(target, "wrangler.jsonc"));
  const { modulesRules, ...workerOptions } = options.workerOptions;
  const worker = new Miniflare(convertV4MiniflareOptions({
    port: 0, inspectorPort: 0, resourcePersistencePath: join(target, ".wrangler/state/v3"),
    workers: [{ ...workerOptions, modules: true, script: built.outputFiles[0].text, bindings: { ...workerOptions.bindings, ...bindings },
      outboundService: request => { throw new Error(`Unexpected restored-expiry network edge: ${new URL(request.url).origin}`); },
    }, ...options.externalWorkers],
  }));
  try {
    const db = await worker.getD1Database("DB");
    assert.deepEqual({ ...await db.prepare("SELECT id,destination,created_at FROM subscribers WHERE id=?").bind(expected.id).first() },
      { id: expected.id, destination: expected.destination, created_at: expected.createdAt }, "native import retains the original pending lifetime");
    const api = async query => {
      const response = await worker.dispatchFetch(origin + "/api/app/audit-log?" + query, { headers: { Host: new URL(origin).host, Cookie: cookie } });
      assert.equal(response.status, 200, await response.clone().text());
      return response;
    };
    const before = (await (await api("action=expired&limit=100")).json()).entries;
    assert.equal(before.filter(row => row.entityId === expected.id).length, 0);
    const scheduled = await worker.getWorker();
    await scheduled.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" });
    await scheduled.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" });
    assert.equal(await db.prepare("SELECT id FROM subscribers WHERE id=?").bind(expected.id).first(), null);
    assert.equal(await db.prepare("SELECT id FROM subscriber_tokens WHERE subscriber_id=?").bind(expected.id).first(), null);
    assert.equal((await db.prepare("SELECT state FROM subscribers WHERE id='portable-reader'").first()).state, "active");
    const rows = (await (await api("action=expired&limit=100")).json()).entries;
    const entries = rows.filter(row => row.entityId === expected.id);
    assert.equal(entries.length, 1, "repeated real Cron delivery expires and audits the restored subscriber once");
    assert.equal(entries[0].actorId, null); assert.equal(entries[0].actorName, "System");
    assert.ok(Number.isFinite(Date.parse(entries[0].createdAt)));
    assert.equal((await db.prepare("SELECT payload_json FROM audit_entries WHERE id=?").bind(entries[0].id).first()).payload_json, "{}");
    const csv = await (await api("action=expired&format=csv")).text();
    assert.equal(csv.trimEnd().split("\r\n").length - 1, rows.length);
    for (const row of rows) assert.ok(csv.includes(`"${row.id}"`));
    assert.ok(!JSON.stringify(rows).includes(expected.destination) && !csv.includes(expected.destination));
  } finally { await worker.dispose(); }
}
