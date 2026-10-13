import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  bindings,
  client,
  inventory,
  publish,
  settle,
  signIn,
} from "./runtime.mjs";

export async function upgradedJourneys(mf, data, before, current, mail) {
  const c = client(mf, data.cookie);
  assert.deepEqual(
    (await c.api("/api/app/session")).operator,
    data.owner,
    "existing native owner session and setup authority survive",
  );
  assert.equal(
    (
      await c.request("/auth/bootstrap", {
        method: "POST",
        json: { token: bindings.SETUP_TOKEN, displayName: "Intruder" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await c.request("/api/app/session", { headers: { Cookie: "" } })).status,
    401,
  );
  const sent = mail.length;
  await settle(mf);
  await c.api(
    `/api/app/statuspage-import/jobs/${data.jobId}/send-invitations`,
    {},
  );
  assert.equal(
    mail.length,
    sent,
    "upgrade, scheduled processing and repeated invitation action replay no mail",
  );
  const afterStartup = await inventory(mf);
  assert.deepEqual(
    afterStartup.tables.notification_deliveries,
    before.tables.notification_deliveries,
    "historical delivery ledger does not replay",
  );
  assert.deepEqual(
    afterStartup.tables.notification_outbox,
    before.tables.notification_outbox,
    "completed outbox commands never replay",
  );
  assert.deepEqual(
    afterStartup.tables.mail_send_ledger,
    before.tables.mail_send_ledger,
    "uncertain provider sends remain retained",
  );
  for (const id of [data.incident.id, data.resolved.id])
    assert.equal(
      (await c.request(`/app/incidents/${id}`)).status,
      200,
      "real operator document renders retained incident",
    );
  const detail = (await c.api(`/api/app/incidents/${data.incident.id}`))
    .incident;
  assert.equal(detail.draft.details, "Never publish this draft during upgrade");
  const publicPage = await c.public("/");
  assert.equal(publicPage.status, 200);
  const html = await publicPage.text();
  assert.match(html, /Owner API/);
  assert.doesNotMatch(html, /Never publish this draft/);
  for (const path of [
    `/incidents/${data.incident.reference}`,
    `/incidents/${(await c.api(`/api/app/incidents/${data.resolved.id}`)).incident.reference}`,
    "/feed.atom",
    "/api/public/status",
  ])
    assert.equal((await c.public(path)).status, 200, path);
  const alias = await c.public("/incidents/i0000000001");
  assert.deepEqual(
    { status: alias.status, location: alias.headers.get("location") },
    data.alias,
    "imported public alias survives",
  );
  assert.equal(
    (await c.public(data.subscriptions.active.managePath)).status,
    200,
  );
  assert.equal(
    (await c.public(data.subscriptions.pending.confirmPath)).status,
    200,
    "pre-upgrade pending confirmation remains valid",
  );
  assert.equal(
    (await c.public(data.subscriptions.deactivated.managePath)).status,
    404,
    "revoked subscriber authority stays revoked",
  );
  assert.equal(
    (
      await c.public(data.subscriptions.active.managePath, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          componentId: data.component.id,
        }).toString(),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await c.public(data.subscriptions.active.unsubscribePath, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      })
    ).status,
    200,
  );
  assert.equal(
    (await c.public(data.subscriptions.active.managePath)).status,
    404,
  );
  assert.equal(
    (await c.api("/api/app/channels")).channels.find(
      (row) => row.id === data.channel.id,
    ).name,
    "Owner channel",
  );
  assert.ok(
    (await c.api("/api/app/intake/sources")).sources.find(
      (row) => row.id === data.preset.id,
    ),
  );
  const alert = await c.public(new URL(data.preset.endpointUrl).pathname, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.preset.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      check_id: 91234,
      check_name: "Owner API",
      check_type: "HTTP",
      previous_state: "UP",
      current_state: "DOWN",
      state_changed_timestamp: Math.floor(Date.now() / 1000),
      description: "Post-upgrade timeout",
    }),
  });
  assert.equal(alert.status, 202, await alert.clone().text());
  // Exercise the new historical-maintenance storage through the real importer.
  const importFiles = await Promise.all(
    (await readdir(join(current, "tests/fixtures/betterstack/small")))
      .filter((name) => !name.startsWith("webhook-"))
      .map(async (name) => ({
        name,
        text: await readFile(
          join(current, "tests/fixtures/betterstack/small", name),
          "utf8",
        ),
      })),
  );
  const input = {
    source: "betterstack",
    publicAccessAcknowledged: true,
    files: importFiles,
  };
  const review = await c.api("/api/app/statuspage-import/preview", input);
  const mailBeforeImport = mail.length;
  let moved = await c.api("/api/app/statuspage-import/apply", {
    ...input,
    asOf: review.report.asOf,
    fingerprint: review.report.fingerprint,
    acknowledged: true,
  });
  for (let i = 0; i < 80 && moved.job.state === "applying"; i++)
    moved = await c.api(
      `/api/app/statuspage-import/jobs/${moved.job.id}/resume`,
      {},
    );
  assert.equal(moved.job.state, "completed");
  const nativeDb = await mf.getD1Database("DB");
  const importedHistory = (
    await nativeDb
      .prepare(
        "SELECT * FROM import_maintenance_updates ORDER BY published_at,id",
      )
      .all()
  ).results;
  assert.ok(
    importedHistory.length,
    "new migration stores imported provider maintenance messages",
  );
  assert.equal(
    mail.length,
    mailBeforeImport,
    "historical import never replays mail",
  );
  await signIn(c, mail);
  assert.deepEqual(
    (await c.api("/api/app/session")).operator,
    data.owner,
    "fresh sign-in resolves the same owner identity",
  );
  const next = (
    await c.api("/api/app/incidents", {
      title: "Published after upgrade",
      components: [
        {
          componentId: data.component.id,
          state: "Degraded performance",
          relationship: "Primary",
        },
      ],
    })
  ).incident;
  const published = await publish(c, next.id);
  assert.ok(
    !before.tables.incidents.some(
      (row) => row.reference === published.reference,
    ),
    "new publication allocates an unused public reference",
  );
  assert.equal(
    (await c.public(`/incidents/${published.reference}`)).status,
    200,
  );
  const response = await c.public("/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "email=new-after-upgrade%40example.test",
  });
  assert.equal(response.status, 202);
  const confirmation = mail
    .at(-1)
    .text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0];
  assert.equal((await c.public(new URL(confirmation).pathname)).status, 200);

  return { c, published };
}
