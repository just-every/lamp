import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { reservePort } from "../e2e/worker-startup.mjs";
const port = await reservePort({ label: "release upgrade" });
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler"),
)("miniflare");
export const app = `http://127.0.0.1:${port}`,
  page = "https://status.upgrade.test";
export const owner = "owner@upgrade.example.test";
export const bindings = {
  LAMP_APP_HOST: new URL(app).hostname,
  LAMP_PAGE_HOST: new URL(page).hostname,
  AUTH_ORIGIN: app,
  AUTH_LOCAL: "true",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  SETUP_TOKEN: randomBytes(32).toString("hex"),
  SETUP_OPERATOR_EMAIL: owner,
  MAIL_FROM_ADDRESS: "status@upgrade.example.test",
  MAIL_PROVIDER_API_KEY: randomBytes(32).toString("hex"),
  SUBSCRIBER_TOKEN_SECRET: randomBytes(32).toString("hex"),
  WEBHOOK_SIGNING_SECRET: randomBytes(32).toString("hex"),
  RER_INSTALLATION_ID: "release-upgrade-fixture",
};
export async function run(cwd, command, args, log) {
  const env = {
    ...process.env,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
  };
  for (const key of Object.keys(env))
    if (
      /^(AUTH_|RER_DEV_|LAMP_|SESSION_SECRET|SETUP_TOKEN|MAIL_PROVIDER)/.test(
        key,
      )
    )
      delete env[key];
  return new Promise((accept, reject) => {
    let output = "";
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    child.on("error", reject);
    child.on("close", async (code) => {
      if (log) await writeFile(log, output);
      code === 0
        ? accept(output)
        : reject(
            new Error(
              `${command} ${args.join(" ")} exited ${code}\n${output.slice(-10000)}`,
            ),
          );
    });
  });
}
async function walk(root, prefix = "") {
  const out = [];
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(root, name)));
    else out.push(name);
  }
  return out;
}
export async function runtime(source, state, mail) {
  const root = join(source, "dist/server");
  const cfg = JSON.parse(await readFile(join(root, "wrangler.json"), "utf8"));
  const modules = await Promise.all(
    (await walk(root))
      .filter((p) => p.endsWith(".js"))
      .map(async (path) => ({
        type: "ESModule",
        path,
        contents: await readFile(join(root, path), "utf8"),
      })),
  );
  modules.sort((a, b) =>
    a.path === cfg.main ? -1 : b.path === cfg.main ? 1 : 0,
  );
  const client = resolve(root, cfg.assets.directory);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "lamp-release-upgrade",
      modules,
      port,
      inspectorPort: 0,
      compatibilityDate: cfg.compatibility_date,
      compatibilityFlags: cfg.compatibility_flags,
      bindings: { ...cfg.vars, ...bindings },
      d1Databases: { DB: cfg.d1_databases[0].database_id },
      r2Buckets: { SNAPSHOTS: cfg.r2_buckets[0].bucket_name },
      durableObjects: {
        SNAPSHOT_CACHE: { className: "SnapshotCache", useSQLite: true },
      },
      queueProducers: { JOBS: "release-upgrade-jobs" },
      queueConsumers: { "release-upgrade-jobs": { maxBatchTimeout: 0 } },
      resourcePersistencePath: join(state, "v3"),
      serviceBindings: {
        ASSETS: async (req) => {
          const path = resolve(client, "." + new URL(req.url).pathname);
          if (!path.startsWith(client + "/"))
            return new Response(null, { status: 404 });
          try {
            return new Response(await readFile(path));
          } catch {
            return new Response(null, { status: 404 });
          }
        },
      },
      outboundService: async (req) => {
        assert.equal(
          new URL(req.url).hostname,
          "api.resend.com",
          "only the mail provider edge is faked",
        );
        mail.push(await req.json());
        return Response.json({ id: "upgrade-mail-" + mail.length });
      },
    }),
  );
  await mf.ready;
  return mf;
}
export async function sql(db, text) {
  return db.batch(unstable_splitSqlQuery(text).map((s) => db.prepare(s)));
}
export async function inventory(mf) {
  const db = await mf.getD1Database("DB");
  const tables = {};
  for (const { name } of (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all()
  ).results) {
    const columns = (await db.prepare(`PRAGMA table_info("${name}")`).all())
      .results;
    const keys = columns
      .filter((c) => c.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => '"' + c.name + '"');
    tables[name] = (
      await db
        .prepare(
          `SELECT * FROM "${name}" ORDER BY ${keys.length ? keys.join(",") : "rowid"}`,
        )
        .all()
    ).results;
  }
  const bucket = await mf.getR2Bucket("SNAPSHOTS"),
    objects = {};
  let cursor;
  do {
    const listed = await bucket.list({ cursor });
    for (const item of listed.objects) {
      const object = await bucket.get(item.key);
      objects[item.key] = {
        bytes: Buffer.from(await object.arrayBuffer()).toString("base64"),
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
      };
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { tables, objects };
}
export function client(mf, cookie = "") {
  const request = (path, { json, form, ...init } = {}) =>
    fetch(app + path, {
      redirect: "manual",
      ...init,
      headers: {
        Host: new URL(app).host,
        Origin: app,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(form
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
        ...init.headers,
      },
      body: json
        ? JSON.stringify(json)
        : form
          ? new URLSearchParams(form).toString()
          : init.body,
    });
  const api = async (path, json, method = json ? "POST" : "GET") => {
    const response = await request(path, { method, json });
    const text = await response.text();
    assert.ok(
      response.status >= 200 && response.status < 300,
      `${method} ${path}: ${response.status} ${text}`,
    );
    return text ? JSON.parse(text) : null;
  };
  return {
    request,
    api,
    public: (path, init) =>
      mf.dispatchFetch(page + path, { redirect: "manual", ...init }),
    setCookie(value) {
      cookie = value;
    },
    get cookie() {
      return cookie;
    },
  };
}
export async function signIn(c, mail) {
  await c.api("/auth/magic-link", { email: owner });
  const message = mail.findLast(
    (item) =>
      JSON.stringify(item.to).includes(owner) &&
      item.text.includes("/auth/confirm"),
  );
  assert.ok(message, "native sign-in mail was captured at the provider edge");
  const link = message.text.match(/https?:\/\/[^\s]+/)[0];
  const response = await c.request("/auth/confirm", {
    method: "POST",
    json: { token: new URL(link).searchParams.get("token") },
  });
  assert.equal(response.status, 303, await response.clone().text());
  c.setCookie(response.headers.get("set-cookie").split(";")[0]);
  return c.cookie;
}
export async function publish(
  c,
  id,
  lifecycle = "Investigating",
  channels = [],
) {
  const current = (await c.api(`/api/app/incidents/${id}`)).incident;
  const headers = {
    "If-Match": `${current.draft?.id ?? "-"}:${current.updates.length}`,
  };
  let r = await c.request(`/api/app/incidents/${id}/draft`, {
    method: "PUT",
    headers,
    json: {
      lifecycle,
      affectedAudience: "API customers",
      customerImpact:
        lifecycle === "Resolved" ? "Service restored" : "Requests are failing",
      whatStillWorks: "Dashboard",
      details: "Upgrade journey publication",
      nextUpdateAt:
        lifecycle === "Resolved"
          ? null
          : new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(r.status, 200, await r.clone().text());
  const saved = (await c.api(`/api/app/incidents/${id}`)).incident;
  r = await c.request(`/api/app/incidents/${id}/publish`, {
    method: "POST",
    headers: { "If-Match": `${saved.draft.id}:${saved.updates.length}` },
    json: { channels },
  });
  assert.equal(r.status, 200, await r.clone().text());
  return (await c.api(`/api/app/incidents/${id}`)).incident;
}
export async function settle(mf) {
  const worker = await mf.getWorker();
  await worker.scheduled({ scheduledTime: Date.now(), cron: "* * * * *" });
  const db = await mf.getD1Database("DB");
  for (let attempt = 0; attempt < 100; attempt++) {
    const pending = await db
      .prepare(
        `SELECT
      (SELECT count(*) FROM notification_outbox WHERE completed_at IS NULL AND failed_at IS NULL) +
      (SELECT count(*) FROM notification_deliveries d WHERE outcome='queued' AND NOT EXISTS (SELECT 1 FROM notification_delivery_attempts a WHERE a.delivery_id=d.id AND a.provider_message_id IS NOT NULL AND a.error IS NULL)) +
      (SELECT count(*) FROM public_snapshot_work WHERE requested_revision<>completed_revision) AS n`,
      )
      .first();
    if (pending.n === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(
    "Worker did not complete its persisted notification and snapshot work",
  );
}
