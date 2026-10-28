import { widgetPrivacyFlow } from "../../e2e/helpers/widget-privacy-flow.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before } from "node:test";
import { chromium } from "playwright";

import { baseline } from "./case.mjs";
import { createBaselineFixture } from "./fixture.mjs";
import { sessionCookieName } from "../../helpers/session-cookie.mjs";

let fixture;

before(async () => {
  fixture = await createBaselineFixture();
});

after(async () => {
  await fixture?.dispose();
});

function publicWrite(path, body, send = fixture.fetch) {
  return send(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

function componentInput(overrides = {}) {
  return {
    groupId: null,
    name: "Baseline component",
    description: "A real component created by the baseline Worker test.",
    internal: false,
    displayOrder: 1,
    note: "",
    ...overrides,
  };
}

function seedDeliveryEvent({ suffix, reference, eventId, deliveryId, subscriberId, outcome = "queued" }) {
  const now = "2026-09-08T00:00:00.000Z";
  const incidentId = `baseline-incident-${suffix}`;
  const updateId = `baseline-update-${suffix}`;
  fixture.sql(`INSERT INTO incidents (id,reference,title,lifecycle,opened_at,resolved_at,created_by_operator_id,deleted_at,deletion_reason,peak_impact,created_at,updated_at) VALUES ('${incidentId}','INC-${reference}','Baseline delivery event','Resolved','${now}','${now}','01J00000000000000000000001',NULL,NULL,'Operational','${now}','${now}'); INSERT INTO incident_updates (id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,next_update_at,published_at,is_retroactive,author_operator_id,corrects_update_id,created_at,updated_at) VALUES ('${updateId}','${incidentId}','Resolved','Baseline readers','Recovered','','Baseline delivery fixture','${now}','${now}',0,'01J00000000000000000000001',NULL,'${now}','${now}'); INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES ('${subscriberId}','email','${suffix}@baseline.test',NULL,'active','all','token-${suffix}','${now}','${now}'); INSERT INTO notification_deliveries (id,subscriber_id,incident_update_id,maintenance_id,channel,outcome,queued_at,outcome_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES ('${deliveryId}','${subscriberId}','${updateId}',NULL,'email','${outcome}','${now}',NULL,'${now}','${now}','${eventId}','incident-update')`);
  return { incidentId, updateId };
}

async function eventuallySql(statement, predicate, label) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = fixture.sql(statement, true);
    if (predicate(rows)) return rows;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

baseline(["BASE-ACCESS-001","BASE-ACCESS-002"], "Owner sign-in and sign-out enforce native session authority", async t => {
  t.diagnostic("magic-link sign-in stores no password field");
  await (async () => {
  const invalid = await fixture.fetchApp("/auth/magic-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({email:"not-an-email"}) });
  assert.equal(invalid.status, 400);
  const unavailable = await fixture.fetchApp("/auth/magic-link", { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"operator@example.test"}) });
  assert.equal(unavailable.status, 503, "the real endpoint asks the mail adapter for a magic link and fails explicitly when it is unconfigured");
  const tables = fixture.sql("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('oa_operators','oa_tokens') ORDER BY name", true);
  assert.deepEqual(tables.map((row) => row.name), ["oa_operators", "oa_tokens"]);
  for (const table of tables) {
    const columns = fixture.sql(`PRAGMA table_info(${table.name})`, true).map((row) => String(row.name).toLowerCase());
    assert.ok(columns.every((name) => !name.includes("password") && !name.includes("passphrase")), `${table.name} has no password storage`);
  }
})(t);
  t.diagnostic("sign-out revokes a real D1 session and operator APIs return 401");
  await (async () => {
  const sessionId = await fixture.session();
  const unauthenticated = await fixture.fetchApp("/api/app/components");
  assert.equal(unauthenticated.status, 401);
  const signout = await fixture.driver.fetch(new Request(`${fixture.appUrl}/api/app/session/signout`, { method: "POST", headers: { Origin:fixture.appUrl, Cookie: `${sessionCookieName(fixture.appUrl)}=${sessionId}` } }));
  assert.equal(signout.status, 204);
  const afterSignout = await fixture.driver.fetch(new Request(`${fixture.appUrl}/api/app/components`, { headers: { Cookie: `${sessionCookieName(fixture.appUrl)}=${sessionId}` } }));
  assert.equal(afterSignout.status, 401);
  const expiredSession=await fixture.session();
  fixture.sql("UPDATE oa_sessions SET expires_at = 0 WHERE operator_id = '01J00000000000000000000001'");
  const expired = await fixture.driver.fetch(new Request(`${fixture.appUrl}/api/app/components`, { headers: { Cookie: `${sessionCookieName(fixture.appUrl)}=${expiredSession}` } }));
  assert.equal(expired.status, 401);
})(t);
});



baseline(["BASE-ACCESS-003","BASE-ACCESS-004"], "Public write limits and operator ownership cannot be forged", async t => {
  t.diagnostic("public read supersession leaves public writes rate-limited");
  await (async () => {
  const manifest = JSON.parse(await readFile("seed.json", "utf8"));
  assert.ok(manifest.deploy.publicPaths.includes("/"));
  const reads = await Promise.all(Array.from({ length: 8 }, () => fixture.fetch("/")));
  assert.ok(reads.every((response) => response.status === 200), "PAGE-008 correctly supersedes read-path rate limiting only");
  const writes = [];
  for (let attempt = 0; attempt < 6; attempt += 1) writes.push(await publicWrite("/subscribe", { email: `reader-${attempt}@baseline.test` }));
  assert.deepEqual(writes.slice(0, 5).map((response) => response.status), [503, 503, 503, 503, 503]);
  assert.equal(writes[5].status, 429, "the sixth unauthenticated public write is rate-limited even while mail is intentionally unavailable");
  assert.equal((await fixture.fetch("/not-a-public-path")).status, 404);
  assert.equal((await fixture.fetchApp("/api/app/components")).status, 401);
})(t);
  t.diagnostic("server ignores client supplied actor and ownership claims");
  await (async () => {
  const before = fixture.sql("SELECT COUNT(*) AS count FROM components", true)[0].count;
  const unauthenticated = await fixture.fetchApp("/api/app/components", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...componentInput(), operatorId: "attacker" }) });
  assert.equal(unauthenticated.status, 401);
  const spoofed = await fixture.appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ ...componentInput(), operatorId: "attacker" }) });
  assert.equal(spoofed.status, 400, "strict boundary schema rejects a client actor field rather than trusting it");
  assert.equal(fixture.sql("SELECT COUNT(*) AS count FROM components", true)[0].count, before);
})(t);
});



baseline(["BASE-INPUT-001","BASE-INPUT-002","BASE-INPUT-003"], "Request validation, escaped public content and authorised typed uploads", async t => {
  t.diagnostic("invalid request bodies and path identifiers stop at the boundary");
  await (async () => {
  const before = fixture.sql("SELECT COUNT(*) AS count FROM components", true)[0].count;
  const invalidBody = await fixture.appFetch("/api/app/components", { method: "POST", body: JSON.stringify({ name: "missing required fields" }) });
  assert.equal(invalidBody.status, 400);
  assert.ok("error" in await invalidBody.json());
  const invalidPath = await fixture.appFetch("/api/app/components/not-an-ulid/history");
  assert.equal(invalidPath.status, 400);
  assert.equal(fixture.sql("SELECT COUNT(*) AS count FROM components", true)[0].count, before);
})(t);
  t.diagnostic("public snapshot renders user text as escaped text");
  await (async () => {
  const created = await fixture.appFetch("/api/app/components", { method: "POST", body: JSON.stringify(componentInput({ name: "Escaping probe", note: "<script>window.baselineLeak=1</script><form action=https://evil.test><input></form><img src=https://evil.test/pixel>" })) });
  assert.equal(created.status, 201);
  const page = await fixture.fetch("/");
  const html = await page.text();
  assert.match(html, /&lt;script&gt;window\.baselineLeak=1&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>window\.baselineLeak=1<\/script>|<form action=https:\/\/evil\.test>|<img src=https:\/\/evil\.test\/pixel>/);
})(t);
  t.diagnostic("authorised PNG upload is private in R2 and public derivative is typed for download");
  await (async () => {
  const invalid = new FormData();
  invalid.set("logo", new Blob(["not an image"], { type: "text/plain" }), "not-image.txt");
  const rejected = await fixture.driver.fetch(new Request(`${fixture.appUrl}/api/app/page-settings/logo`, { method: "POST", body: invalid, headers: { Origin: fixture.appUrl, Cookie: `${sessionCookieName(fixture.appUrl)}=${await fixture.session()}` } }));
  assert.equal(rejected.status, 400);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAF/gL+3N9nPwAAAABJRU5ErkJggg==", "base64");
  const accepted = new FormData(); accepted.set("logo", new Blob([png], { type: "image/png" }), "baseline.png");
  const uploaded = await fixture.driver.fetch(new Request(`${fixture.appUrl}/api/app/page-settings/logo`, { method: "POST", body: accepted, headers: { Origin: fixture.appUrl, Cookie: `${sessionCookieName(fixture.appUrl)}=${await fixture.session()}` } }));
  assert.equal(uploaded.status, 200);
  const settings = await uploaded.json();
  assert.equal(settings.settings.logoContentType, "image/png");
  const privateKey = fixture.sql("SELECT logo_key AS key FROM page_settings WHERE id = 'default'", true)[0].key;
  assert.match(privateKey, /^branding\/logos\//);
  const publicLogo = await fixture.fetch("/assets/logo");
  assert.equal(publicLogo.status, 200);
  assert.equal(publicLogo.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await publicLogo.arrayBuffer()), png, "the R2-backed snapshot derivative retains the uploaded bytes");
  assert.match(publicLogo.headers.get("content-disposition") ?? "", /^attachment(?:;|$)/i, "public binary download has an explicit download disposition");
})(t);
});





baseline(["BASE-SECRET-001","BASE-SECRET-002"], "Secrets remain private and missing required bindings fail closed", async t => {
  t.diagnostic("configured signing secrets do not leak through public, operator, error, or Worker output");
  await (async () => {
  const page = await fixture.fetch("/");
  const settings = await fixture.appFetch("/api/app/page-settings");
  const subscribers = await fixture.appFetch("/api/app/subscribers");
  const management = await fixture.fetch("/manage/not-a-real-token");
  const invalidBoundary = await fixture.appFetch("/api/app/components/not-an-ulid/history");
  assert.equal(page.status, 200);
  assert.equal(settings.status, 200);
  assert.equal(subscribers.status, 200);
  assert.equal(management.status, 404, "the configured subscriber signing key validated the malformed management token");
  assert.equal(invalidBoundary.status, 400);
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  let clientBodies = [];
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: sessionCookieName(fixture.appUrl), value: await fixture.session(), url: fixture.appUrl }]);
    const operatorPage = await context.newPage();
    const clientResponses = [];
    operatorPage.on("response", (response) => {
      const contentType = response.headers()["content-type"] ?? "";
      if (new URL(response.url()).origin === fixture.appUrl && /(?:javascript|css)/i.test(contentType)) clientResponses.push(response);
    });
    await operatorPage.goto(`${fixture.appUrl}/app`, { waitUntil: "networkidle" });
    clientBodies = await Promise.all(clientResponses.map((response) => response.text()));
    assert.ok(clientBodies.length > 0, "the authenticated operator shell loaded real same-origin JavaScript or CSS");
  } finally {
    await browser.close();
  }
  const outputs = [await page.text(), await settings.text(), await subscribers.text(), await management.text(), await invalidBoundary.text(), ...clientBodies, fixture.logs()].join("\n");
  assert.equal(page.headers.get("set-cookie"), null);
  for (const secret of fixture.secrets) assert.doesNotMatch(outputs, new RegExp(secret), `secret sentinel leaked: ${secret}`);
})(t);
  t.diagnostic("a real Worker fails closed and names a missing host binding");
  await (async () => {
  const missingHost = await createBaselineFixture({ omitBinding: "LAMP_PAGE_HOST" });
  try {
    const response = await missingHost.fetch("/");
    assert.equal(response.status, 500);
    assert.match(missingHost.logs(), /LAMP_PAGE_HOST is required\./);
  } finally {
    await missingHost.dispose();
  }
  // One hostname for both surfaces would leave `/` ambiguous between the status page and the landing page.
  const sharedHost = await createBaselineFixture({ bindings: { LAMP_PAGE_HOST: "127.0.0.1", LAMP_APP_HOST: "127.0.0.1" } });
  try {
    const response = await sharedHost.fetchApp("/");
    assert.equal(response.status, 500);
    assert.match(sharedHost.logs(), /LAMP_PAGE_HOST and LAMP_APP_HOST must be different/);
  } finally {
    await sharedHost.dispose();
  }
})(t);
});



baseline("BASE-DATA-001", "real D1 and R2 export-import-export preserves the archive", async () => {
  const target = await mkdtemp(join(tmpdir(), "lamp-baseline-import-"));
  const archive = await mkdtemp(join(tmpdir(), "lamp-baseline-export-"));
  const restored = await mkdtemp(join(tmpdir(), "lamp-baseline-restored-"));
  try {
    fixture.r2Object("baseline/attachment.txt", "baseline attachment", "text/plain; charset=utf-8");
    execFileSync("pnpm", ["run", "export:cloudflare", "--", "--out", archive, "--persist-to", fixture.statePath], { stdio: "pipe" });
    execFileSync("pnpm", ["run", "import:cloudflare", "--", "--from", archive, "--persist-to", target], { stdio: "pipe" });
    execFileSync("pnpm", ["run", "export:cloudflare", "--", "--out", restored, "--persist-to", target], { stdio: "pipe" });
    assert.deepEqual(JSON.parse(await readFile(join(restored, "entities.json"), "utf8")), JSON.parse(await readFile(join(archive, "entities.json"), "utf8")));
    const manifest = JSON.parse(await readFile(join(restored, "manifest.json"), "utf8"));
    assert.ok(manifest.objects.some((object) => object.key === "baseline/attachment.txt" && object.contentType === "text/plain; charset=utf-8"));
  } finally {
    await Promise.all([rm(target, { recursive: true, force: true }), rm(archive, { recursive: true, force: true }), rm(restored, { recursive: true, force: true })]);
  }
});

baseline(["BASE-DATA-002","BASE-DATA-003","BASE-DATA-004"], "Retention and erasure preserve attribution without undeclared data transfer", async t => {
  t.diagnostic("only the pending-subscription exception is expired automatically");
  await (async () => {
  fixture.sql("INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES ('baseline-old-pending','email','pending@baseline.test',NULL,'pending','all','pending-token','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'),('baseline-active','email','active@baseline.test',NULL,'active','all','active-token','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')");
  const scheduled = await fixture.fetch("/cdn-cgi/local/scheduled");
  assert.equal(scheduled.status, 200);
  for (let attempt = 0; attempt < 25 && fixture.sql("SELECT id FROM subscribers WHERE id = 'baseline-old-pending'", true).length; attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  assert.equal(fixture.sql("SELECT id FROM subscribers WHERE id = 'baseline-old-pending'", true).length, 0, "SUB-003's 72-hour pending exception ran");
  assert.equal(fixture.sql("SELECT state FROM subscribers WHERE id = 'baseline-active'", true)[0].state, "active", "ordinary retained user data was not automatically deleted");
})(t);
  t.diagnostic("operator erasure removes subscriber and operator personal data while retaining audit attribution");
  await (async () => {
  const subscriberId = "01J00000000000000000000070";
  fixture.sql(`INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES ('${subscriberId}','webhook','https://receiver.example.test/hook','person@baseline.test','active','all','delete-token','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z')`);
  const erased = await fixture.appFetch(`/api/app/subscribers/${subscriberId}`, { method: "DELETE" });
  assert.equal(erased.status, 204);
  const subscriber = fixture.sql(`SELECT destination,contact_email,state FROM subscribers WHERE id = '${subscriberId}'`, true)[0];
  assert.equal(subscriber.destination, `deleted:${subscriberId}`);
  assert.equal(subscriber.contact_email, null);
  assert.equal(subscriber.state, "deactivated");
  const audit = fixture.sql(`SELECT operator_id AS operatorId,action FROM audit_entries WHERE entity_id = '${subscriberId}' ORDER BY created_at DESC LIMIT 1`, true)[0];
  assert.deepEqual(audit, { operatorId: "01J00000000000000000000001", action: "deleted" });

  const operatorId = "01J00000000000000000000072";
  const operatorEmail = "erased.operator@baseline.test";
  const operatorName = "Erased Operator";
  fixture.sql(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES ('${operatorId}','${operatorEmail}','${operatorName}','owner','active',${Date.now()}); INSERT INTO audit_entries (id,entity_type,entity_id,action,operator_id,reason,payload_json,created_at,updated_at) VALUES ('01J00000000000000000000075','operator','${operatorId}','invited','01J00000000000000000000001','Invited ${operatorName}','{"email":"${operatorEmail}","displayName":"${operatorName}"}','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z')`);
  // Real retained Base credentials make revocation assertions non-vacuous.
  fixture.sql(`INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,return_to,created_at,expires_at) VALUES ('baseline-operator-link','baseline-operator-link-digest','magic','${operatorId}',1,'/app',${Date.now()},${Date.now()+600000}); INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,created_at,expires_at) VALUES ('baseline-operator-session','baseline-operator-session-digest','${operatorId}',1,'native',${Date.now()},${Date.now()+600000})`);
  const removedOperator = await fixture.appFetch(`/api/app/operators/${operatorId}`, { method: "DELETE" });
  assert.equal(removedOperator.status, 204);
  const listedOperators = await fixture.appFetch("/api/app/operators");
  assert.equal(listedOperators.status, 200);
  assert.equal((await listedOperators.json()).operators.some((operator) => operator.id === operatorId), false, "the erased operator is no longer an allow-listed account");
  assert.equal(fixture.sql(`SELECT COUNT(*) AS count FROM oa_sessions WHERE operator_id = '${operatorId}' AND revoked_at IS NULL`, true)[0].count, 0, "operator sessions are revoked");
  const erasedOperatorRows = fixture.sql(`SELECT email AS email,display_name AS displayName FROM operators WHERE id = '${operatorId}'`, true);
  const erasedLinkRows = fixture.sql(`SELECT revoked_at AS revokedAt FROM oa_tokens WHERE operator_id = '${operatorId}'`, true);
  assert.doesNotMatch(JSON.stringify([erasedOperatorRows, erasedLinkRows]), new RegExp(`${operatorEmail}|${operatorName}`), "operator and sign-in-link personal data are redacted");
  assert.equal(erasedLinkRows.length, 1, "the issued link remains as revoked history");
  assert.ok(erasedLinkRows.every((link) => link.revokedAt), "every retained magic link is revoked");
  const operatorAudits = fixture.sql(`SELECT operator_id AS operatorId,action,reason,payload_json AS payloadJson,created_at AS createdAt FROM audit_entries WHERE entity_type = 'operator' AND entity_id = '${operatorId}' ORDER BY created_at ASC`, true);
  const operatorAudit = operatorAudits.find((entry) => entry.action === "deleted");
  assert.ok(operatorAudit, "operator erasure retains a new opaque deletion audit fact");
  assert.equal(operatorAudit.operatorId, "01J00000000000000000000001");
  assert.equal(operatorAudit.action, "deleted");
  assert.match(operatorAudit.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(operatorAudits), new RegExp(`${operatorEmail}|${operatorName}`), "historic invitation and deletion audit records retain no erased personal data");
})(t);
  t.diagnostic("public response carries no undeclared outbound user-data request");
  await (async () => {
  const manifest = JSON.parse(await readFile("seed.json", "utf8"));
  assert.ok(Array.isArray(manifest.externals));
  const html = await (await fixture.fetch("/")).text();
  assert.doesNotMatch(html, /<(?:script|img|link|iframe)[^>]+https?:\/\//i);
  await widgetPrivacyFlow(fixture);
})(t);
});





baseline(["BASE-DATA-005","BASE-PUBLIC-001","BASE-PUBLIC-002"], "Public artifacts remain private, same-origin and restricted to allowed widget hosts", async t => {
  t.diagnostic("public artifacts contain no marketplace, author, telemetry, or licence request");
  await (async () => {
  const [page, widget] = await Promise.all([fixture.fetch("/"), fixture.fetch("/widget.js")]);
  const bytes = `${await page.text()}\n${await widget.text()}`;
  assert.doesNotMatch(bytes, /telemetry|phone-home|licen[cs]e check|marketplace/i);
  assert.doesNotMatch(bytes, /https?:\/\/[^"'\s]*runeditrun\.com/i, "a static credit is not a network request to the author");
})(t);
  t.diagnostic("public surface is cookieless and same-origin before interaction");
  await (async () => {
  const response = await fixture.fetch("/");
  await response.text();
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(response.headers.get("content-security-policy") ?? "", new RegExp(`default-src ${fixture.pageUrl}`));
  const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(`${fixture.pageUrl}/`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => document.cookie), "");
    assert.ok(requests.length > 0);
    assert.ok(requests.every((url) => new URL(url).origin === fixture.pageUrl), `initial public requests escaped same-origin: ${requests.join(", ")}`);
  } finally { await browser.close(); }
  const tokenResponse = await fixture.fetch("/manage/not-a-real-token");
  assert.equal(tokenResponse.headers.get("referrer-policy"), "no-referrer", "SUB-005's token-addressed exception retains referrer protection");
  assert.equal(tokenResponse.headers.get("set-cookie"), null);
})(t);

});





baseline(["BASE-OPS-001","BASE-OPS-002"], "Health dependency probes and prior-data upgrades use the real runtime", async t => {
  t.diagnostic("real Worker health probes D1, R2, and Queue within one second");
  await (async () => {
  const started = performance.now();
  const response = await fixture.fetchApp("/health");
  const elapsed = performance.now() - started;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.ok, true);
  assert.deepEqual(Object.keys(body.deployment).sort(), ["fingerprint", "sourceSha", "versionId"], "health names the deployment that answered");
  assert.ok(elapsed < 1000, `health took ${elapsed.toFixed(1)}ms`);
})(t);
  t.diagnostic("previous migration inventory advances on a real local D1");
  await (async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "lamp-baseline-migration-"));
  try {
    const prior = join(sandbox, "prior-migrations");
    await (await import("node:fs/promises")).mkdir(prior);
    const migrations = (await readdir("migrations/core")).filter((name) => name.endsWith(".sql")).sort();
    const current = migrations.at(-1);
    assert.ok(current, "a current migration exists");
    for (const name of migrations.filter((name) => name !== current)) await writeFile(join(prior, name), await readFile(join("migrations/core", name)));
    const config = join(sandbox, "wrangler.toml");
    await writeFile(config, `name = \"baseline-migration\"\nmain = \"noop.js\"\ncompatibility_date = \"2026-08-31\"\n[[d1_databases]]\nbinding = \"DB\"\ndatabase_name = \"baseline-migration\"\ndatabase_id = \"00000000-0000-0000-0000-000000000000\"\nmigrations_dir = ${JSON.stringify(prior)}\n`);
    execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", sandbox], { maxBuffer: 4 * 1024 * 1024, stdio: "pipe" });
    const sampleSql = "INSERT INTO operators (id,email,display_name,is_setup_operator,created_at,updated_at) VALUES ('migration-owner','owner@example.test','Preserved owner',1,'2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z'); INSERT INTO components (id,name,description,internal,display_order,note,created_at,updated_at) VALUES ('migration-component','Owner API','Owner custom description',0,1,'Keep this note','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z');";
    execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", config, "--persist-to", sandbox, "--command", sampleSql], { stdio: "pipe" });
    await writeFile(config, `name = \"baseline-migration\"\nmain = \"noop.js\"\ncompatibility_date = \"2026-08-31\"\n[[d1_databases]]\nbinding = \"DB\"\ndatabase_name = \"baseline-migration\"\ndatabase_id = \"00000000-0000-0000-0000-000000000000\"\nmigrations_dir = ${JSON.stringify(resolve("migrations/core"))}\n`);
    execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", sandbox], { maxBuffer: 4 * 1024 * 1024, stdio: "pipe" });
    const output = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", config, "--persist-to", sandbox, "--command", "SELECT name FROM d1_migrations ORDER BY name", "--json"], { encoding: "utf8" });
    const applied = JSON.parse(output)[0].results.map((row) => row.name);
    assert.deepEqual(applied, migrations);
    const preserved = JSON.parse(execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", config, "--persist-to", sandbox, "--command", "SELECT name,description,note FROM components WHERE id = 'migration-component'; SELECT email,display_name FROM operators WHERE id = 'migration-owner';", "--json"], { encoding: "utf8" }));
    assert.deepEqual(preserved[0].results, [{ name: "Owner API", description: "Owner custom description", note: "Keep this note" }]);
    assert.deepEqual(preserved[1].results, [{ email: "owner@example.test", display_name: "Preserved owner" }]);
  } finally { await rm(sandbox, { recursive: true, force: true }); }
})(t);
});



baseline(["BASE-OPS-003","BASE-OPS-004","BASE-OPS-005"], "Durable delivery idempotency, visible failures and attributable erasure", async t => {
  t.diagnostic("duplicate delivery event rows remain a single durable idempotency fact");
  await (async () => {
  const eventId = "baseline-idempotent-event";
  seedDeliveryEvent({ suffix: "idempotent", reference: "91001", eventId, deliveryId: "baseline-idempotent-delivery", subscriberId: "baseline-idempotent-subscriber" });
  fixture.sql(`INSERT OR IGNORE INTO notification_deliveries (id,subscriber_id,incident_update_id,maintenance_id,channel,outcome,queued_at,outcome_at,created_at,updated_at,notification_event_id,notification_event_type) SELECT 'baseline-idempotent-duplicate',subscriber_id,incident_update_id,maintenance_id,channel,outcome,queued_at,outcome_at,created_at,updated_at,notification_event_id,notification_event_type FROM notification_deliveries WHERE id = 'baseline-idempotent-delivery'; INSERT INTO notification_outbox (id,kind,aggregate_id,payload_json,available_at,attempts,locked_at,completed_at,failed_at,last_error,created_at,updated_at) VALUES ('baseline-idempotent-outbox','delivery-dispatch','${eventId}','{"eventId":"${eventId}"}','2026-01-01T00:00:00.000Z',0,NULL,NULL,NULL,NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`);
  assert.equal(fixture.sql(`SELECT COUNT(*) AS count FROM notification_deliveries WHERE subscriber_id = 'baseline-idempotent-subscriber' AND notification_event_id = '${eventId}' AND channel = 'email'`, true)[0].count, 1);
  assert.equal((await fixture.fetch("/cdn-cgi/local/scheduled")).status, 200);
  await eventuallySql("SELECT COUNT(*) AS count FROM notification_delivery_attempts WHERE delivery_id = 'baseline-idempotent-delivery'", (rows) => rows[0].count === 1, "the first real Worker dispatch attempt");
  assert.equal((await fixture.fetch("/cdn-cgi/local/scheduled")).status, 200);
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  assert.equal(fixture.sql("SELECT COUNT(*) AS count FROM notification_delivery_attempts WHERE delivery_id = 'baseline-idempotent-delivery'", true)[0].count, 1, "duplicate scheduled delivery sees one durable attempt while retry is not due");
})(t);
  t.diagnostic("a failed delivery remains visible to the operator API");
  await (async () => {
  const eventId = "baseline-failed-event";
  seedDeliveryEvent({ suffix: "failed", reference: "91002", eventId, deliveryId: "baseline-failed-delivery", subscriberId: "baseline-failed-subscriber" });
  fixture.sql(`INSERT INTO notification_delivery_attempts (id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at) VALUES ('baseline-failure-attempt-1','baseline-failed-delivery',1,'2026-09-08T00:00:01.000Z',NULL,'prior retry','2026-09-08T00:00:01.000Z'),('baseline-failure-attempt-2','baseline-failed-delivery',2,'2026-09-08T00:00:02.000Z',NULL,'prior retry','2026-09-08T00:00:02.000Z'),('baseline-failure-attempt-3','baseline-failed-delivery',3,'2026-09-08T00:00:03.000Z',NULL,'prior retry','2026-09-08T00:00:03.000Z'),('baseline-failure-attempt-4','baseline-failed-delivery',4,'2026-09-08T00:00:04.000Z',NULL,'prior retry','2026-09-08T00:00:04.000Z'),('baseline-failure-attempt-5','baseline-failed-delivery',5,'2026-09-08T00:00:05.000Z',NULL,'prior retry','2026-09-08T00:00:05.000Z'); INSERT INTO notification_outbox (id,kind,aggregate_id,payload_json,available_at,attempts,locked_at,completed_at,failed_at,last_error,created_at,updated_at) VALUES ('baseline-failed-outbox','delivery-dispatch','${eventId}','{"eventId":"${eventId}"}','2026-01-01T00:00:00.000Z',0,NULL,NULL,NULL,NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`);
  assert.equal((await fixture.fetch("/cdn-cgi/local/scheduled")).status, 200);
  await eventuallySql("SELECT outcome FROM notification_deliveries WHERE id = 'baseline-failed-delivery'", (rows) => rows[0]?.outcome === "failed", "delivery retry exhaustion");
  const visible = await fixture.appFetch("/api/app/deliveries?outcome=failed");
  assert.equal(visible.status, 200);
  const body = await visible.json();
  assert.ok(body.deliveries.some((delivery) => delivery.id === "baseline-failed-delivery" && delivery.outcome === "failed"));
})(t);
  t.diagnostic("destructive action retains actor and time in audit after PII erasure");
  await (async () => {
  const subscriberId = "01J00000000000000000000071";
  fixture.sql(`INSERT INTO subscribers (id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES ('${subscriberId}','email','audit@baseline.test',NULL,'active','all','audit-token','2026-09-08T00:00:00.000Z','2026-09-08T00:00:00.000Z')`);
  assert.equal((await fixture.appFetch(`/api/app/subscribers/${subscriberId}`, { method: "DELETE" })).status, 204);
  const audit = fixture.sql(`SELECT operator_id AS operatorId,created_at AS createdAt FROM audit_entries WHERE entity_id = '${subscriberId}' AND action = 'deleted'`, true)[0];
  assert.equal(audit.operatorId, "01J00000000000000000000001");
  assert.match(audit.createdAt, /^\d{4}-\d{2}-\d{2}T/);
})(t);
});
