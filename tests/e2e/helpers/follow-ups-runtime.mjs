import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
import { withDraftVersion } from "../draft-version-helper.mjs";
import { reservePort } from "../worker-startup.mjs";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
export const pageOrigin = "https://status.example.test";

export async function eventuallyFollowUp(read, predicate, description) {
  let last;
  for (let attempt = 0; attempt < 100; attempt++) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`${description}: ${JSON.stringify(last)}`);
}

/** Disposable migrated Worker. Only the email/webhook network edges are fake;
 * Queue outage injection is the existing queue-outage.worker.ts boundary. */
export async function openFollowUpsRuntime({ resendWebhookSecret, webhookReceiver, pageHost = "status.example.test", extraBindings = {}, providerEdge, workerEntry = "tests/e2e/helpers/follow-ups-worker.ts" } = {}) {
  const state = await mkdtemp(join(tmpdir(), "lamp-follow-ups-"));
  const messages = [], webhookRequests = [], channelRequests = [], mailReceipts = [];
  let runtime, webhookOutage = true, cookie;
  const sessions = new Map();
  const consumedSignInMessages = new Set();
  try {
    const built = await build({
      entryPoints: [workerEntry], bundle: true,
      format: "esm", platform: "browser", write: false,
      external: ["cloudflare:workers", "node:*"],
      define: { "import.meta.env.DEV": "false" },
      plugins: [{ name: "vite-assets", setup(builder) {
        builder.onResolve({ filter: /\?(inline|raw)$/ }, args => ({ path: resolve(args.resolveDir, args.path.split("?")[0]), namespace: args.path.endsWith("?raw") ? "raw" : "inline" }));
        builder.onLoad({ filter: /.*/, namespace: "raw" }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, "utf8"))}`, loader: "js" }));
        builder.onLoad({ filter: /.*/, namespace: "inline" }, async args => ({ contents: `export default ${JSON.stringify("data:application/octet-stream;base64," + (await readFile(args.path)).toString("base64"))}`, loader: "js" }));
      } }],
    });
    // Allocate for this open after bundling, never across fixture lifetimes.
    const appPort = await reservePort({ label: "follow-ups Worker" });
    const appOrigin = `http://127.0.0.1:${appPort}`;
    const runtimeOptions = convertV4MiniflareOptions({
      name: "lamp-follow-ups-test", modules: true, script: built.outputFiles[0].text,
      port: appPort, inspectorPort: 0, compatibilityDate: "2026-09-08", compatibilityFlags: ["nodejs_compat"],
      bindings: {
        LAMP_PAGE_HOST: pageHost, LAMP_APP_HOST: "127.0.0.1",
        AUTH_ORIGIN: appOrigin, AUTH_LOCAL: "true", SETUP_OPERATOR_EMAIL: "synthetic-lamp-owner@example.test",
        SESSION_SECRET: "synthetic-lamp-session-1".repeat(4), SETUP_TOKEN: "synthetic-lamp-setup-1".repeat(4),
        SUBSCRIBER_TOKEN_SECRET: "synthetic-lamp-subscriber-1".repeat(4),
        WEBHOOK_SIGNING_SECRET: "synthetic-lamp-webhook-1".repeat(4),
        MAIL_PROVIDER: "resend", MAIL_PROVIDER_API_KEY: "synthetic-lamp-mail-1",
        MAIL_FROM_ADDRESS: "synthetic-lamp-sender@example.test",
        ...(resendWebhookSecret ? { RESEND_WEBHOOK_SECRET: resendWebhookSecret } : {}),
        ...extraBindings,
      },
      d1Databases: ["DB"], r2Buckets: ["SNAPSHOTS"],
      durableObjects: { SNAPSHOT_CACHE: { className: "SnapshotCache", useSQLite: true } },
      queueProducers: { JOBS: "lamp-follow-ups-jobs" },
      queueConsumers: { "lamp-follow-ups-jobs": { maxBatchTimeout: 0 } },
      resourcePersistencePath: join(state, "storage"),
      outboundService: async request => {
        const intercepted = await providerEdge?.(request);
        if (intercepted) return intercepted;
        const url = new URL(request.url);
        if (url.origin === "https://api.resend.com" && url.pathname === "/emails") {
          const message = await request.json();
          messages.push(message);
          if (message.to.includes("synthetic-lamp-rejected@example.test") && !message.text.includes("/confirm-subscription/")) {
            return Response.json({ message: "Synthetic Lamp provider rejected this notification" }, { status: 400 });
          }
          const id = `synthetic-lamp-mail-${messages.length}`;
          mailReceipts.push({ id, idempotencyKey: request.headers.get("Idempotency-Key") });
          return Response.json({ id });
        }
        if (url.origin === "https://receiver.example.test" && ["/synthetic-lamp-1", "/synthetic-lamp-components"].includes(url.pathname)) {
          const rawBody = await request.text();
          const captured = { rawBody, body: JSON.parse(rawBody), headers: Object.fromEntries(request.headers) };
          webhookRequests.push(captured);
          if (webhookOutage) return new Response(null, { status: 500 });
          return webhookReceiver ? await webhookReceiver(captured) : new Response(null, { status: 204 });
        }
        if (url.origin === "https://hooks.slack.com" && url.pathname === "/services/synthetic-lamp-1/synthetic-lamp-2/synthetic-lamp-3") {
          channelRequests.push(await request.json());
          return new Response("invalid_payload", { status: 400 });
        }
        throw new Error(`Unexpected follow-up fixture network edge: ${url.origin}${url.pathname}`);
      },
    });
    runtime = new Miniflare(runtimeOptions);
    let db = await runtime.getD1Database("DB");
    const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
    for (const migration of (await readdir("migrations/core")).filter(name => name.endsWith(".sql")).sort()) await execute(await readFile(join("migrations/core", migration), "utf8"));
    // Installation identity/settings are fixture prerequisites. Every obligation
    // below is created through an ordinary operator or public HTTP request.
    await execute(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES ('01J00000000000000000000091','synthetic-lamp-owner@example.test','Synthetic Lamp owner','owner','active',${Date.now()});
      INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at) VALUES(1,'01J00000000000000000000091',${Date.now()});
      INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES('default','Synthetic Lamp follow-ups','Durable obligation fixture','#16794C','UTC','${pageHost}','synthetic-lamp-feed-1','synthetic-lamp-sender@example.test','2026-10-01','2026-10-01');
      INSERT INTO setup_readiness(step,evidence_key,checked_at) VALUES('first-run','complete','2026-10-01');`);
    const raw = (path, init = {}) => {
      const url = new URL(path, appOrigin), headers = new Headers(init.headers);
      headers.set("Host", url.host);
      return runtime.dispatchFetch(url.href, { redirect: "manual", ...init, headers });
    };
    const request = async (path, init = {}) => {
      init = await withDraftVersion(path, init, read => raw(read, { headers: { Cookie: cookie ?? "" } }));
      const headers = new Headers(init.headers);
      headers.set("Origin", appOrigin);
      if (cookie) headers.set("Cookie", cookie);
      if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      return raw(path, { ...init, headers });
    };
    const api = async (path, init = {}) => {
      const response = await request(path, init);
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, text };
    };
    const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });
    async function signIn(email = "synthetic-lamp-owner@example.test", { fresh = false } = {}) {
      if (fresh) sessions.delete(email);
      if (sessions.has(email)) { cookie = sessions.get(email); return; }
      const anonymous = async (path, value) => raw(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: appOrigin }, body: JSON.stringify(value) });
      let ownerMail = messages.find(message => message.to.includes(email) && /invited/i.test(message.subject) && !consumedSignInMessages.has(message));
      if (!ownerMail) {
        const before = messages.length;
        const linkRequest = await anonymous("/auth/magic-link", { email });
        assert.ok(linkRequest.status >= 200 && linkRequest.status < 300, await linkRequest.clone().text());
        ownerMail = await eventuallyFollowUp(() => messages.slice(before).find(message => message.to.includes(email)), Boolean, "owner sign-in mail crosses the real Resend serializer");
      }
      const token = new URL(ownerMail.text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get("token");
      const confirmed = await anonymous("/auth/confirm", { token });
      assert.equal(confirmed.status, 303, await confirmed.clone().text());
      cookie = confirmed.headers.get("set-cookie").split(";")[0];
      sessions.set(email, cookie);
      consumedSignInMessages.add(ownerMail);
    }
    await signIn();
    return {
      get runtime() { return runtime; }, get db() { return db; },
      execute, appOrigin, publicOrigin: pageHost === "localhost" ? `http://localhost:${appPort}` : `https://${pageHost}`, api, post, request, raw, messages, mailReceipts, webhookRequests, channelRequests, signIn,
      async restart() {
        await runtime.dispose();
        runtime = new Miniflare(runtimeOptions);
        db = await runtime.getD1Database("DB");
      },
      recoverWebhook() { webhookOutage = false; },
      async close() { try { await runtime.dispose(); } finally { await rm(state, { recursive: true, force: true }); } },
    };
  } catch (cause) {
    try { await runtime?.dispose(); } finally { await rm(state, { recursive: true, force: true }); }
    throw cause;
  }
}
