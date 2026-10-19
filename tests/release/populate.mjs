import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { moveInDoor } from "../helpers/import-notifications.mjs";
import {
  bindings,
  client,
  owner,
  page,
  publish,
  settle,
  signIn,
  sql,
} from "./runtime.mjs";
export async function populate(mf, source, mail) {
  const c = client(mf),
    db = await mf.getD1Database("DB");
  const boot = await c.request("/auth/bootstrap", {
    method: "POST",
    json: { token: bindings.SETUP_TOKEN, displayName: "Upgrade owner" },
  });
  assert.equal(boot.status, 303, await boot.clone().text());
  c.setCookie(boot.headers.get("set-cookie").split(";")[0]);
  // Deployment setup writes the initial settings row; bootstrap and every operator
  // and subscriber credential below go through the emitted Worker's public doors.
  await sql(
    db,
    `INSERT INTO page_settings(id,page_name,tagline,accent_color,timezone,hostname,mail_from_address,feed_id,created_at,updated_at) VALUES('default','Upgrade status','Owner retained page','#16794c','UTC','status.upgrade.test','status@upgrade.example.test','upgrade-feed-identity','2026-01-01','2026-01-01')`,
  );
  await c.api("/api/app/overview/first-run", {});
  await signIn(c, mail);
  const group = (
    await c.api("/api/app/component-groups", {
      name: "Owner services",
      displayOrder: 0,
    })
  ).group;
  const component = (
    await c.api("/api/app/components", {
      name: "Owner API",
      description: "Retained customer service",
      groupId: group.id,
      internal: false,
      displayOrder: 0,
      note: "Keep owner routing",
    })
  ).component;
  const logo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm4kAAAAASUVORK5CYII=",
    "base64",
  );
  const form = new FormData();
  form.set("logo", new File([logo], "owner.png", { type: "image/png" }));
  const uploaded = await c.request("/api/app/page-settings/logo", {
    method: "POST",
    body: form,
  });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const logoKey = (await uploaded.json()).settings.logoKey;
  const subscriptions = {};
  for (const [name, confirm] of [
    ["active", true],
    ["pending", false],
    ["deactivated", true],
  ]) {
    const email = `${name}@upgrade.example.test`;
    const response = await c.public("/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email }).toString(),
    });
    assert.equal(response.status, 202, await response.clone().text());
    const message = mail.findLast((m) => JSON.stringify(m.to).includes(email));
    assert.ok(message);
    const confirmPath = new URL(
      message.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0],
    ).pathname;
    if (confirm) assert.equal((await c.public(confirmPath)).status, 200);
    subscriptions[name] = { email, confirmPath };
  }
  const active = await db
    .prepare("SELECT * FROM subscribers WHERE destination=?")
    .bind(subscriptions.active.email)
    .first();
  const incident = (
    await c.api("/api/app/incidents", {
      title: "Retained active incident",
      components: [
        {
          componentId: component.id,
          state: "Partially unavailable",
          relationship: "Primary",
        },
      ],
    })
  ).incident;
  const published = await publish(c, incident.id, "Investigating", ["email"]);
  await settle(mf);
  const deliveryMail = mail.findLast(
    (m) =>
      JSON.stringify(m.to).includes(subscriptions.active.email) &&
      m.text.includes("/manage/"),
  );
  assert.ok(
    deliveryMail,
    "native publication delivers real subscriber management credentials",
  );
  for (const name of ["active", "deactivated"]) {
    const message = mail.findLast(
      (m) =>
        JSON.stringify(m.to).includes(subscriptions[name].email) &&
        m.text.includes("/manage/"),
    );
    assert.ok(message);
    subscriptions[name].managePath = new URL(
      message.text.match(/https?:\/\/[^\s]+\/manage\/[^\s]+/)[0],
    ).pathname;
    subscriptions[name].unsubscribePath = new URL(
      message.text.match(/https?:\/\/[^\s]+\/unsubscribe\/[^\s]+/)[0],
    ).pathname;
  }
  assert.equal(
    (
      await c.public(subscriptions.active.managePath, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ componentId: component.id }).toString(),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await c.public(subscriptions.deactivated.unsubscribePath, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      })
    ).status,
    200,
  );
  const resolved = (
    await c.api("/api/app/incidents", {
      title: "Retained resolved incident",
      components: [
        {
          componentId: component.id,
          state: "Degraded performance",
          relationship: "Primary",
        },
      ],
    })
  ).incident;
  await publish(c, resolved.id);
  await publish(c, resolved.id, "Resolved");
  await c.api(
    `/api/app/incidents/${resolved.id}/report`,
    {
      summary: "Retained postmortem",
      timeline: "First failure, repair, recovery",
      cause: "Exhausted worker pool",
      remediation: "Increase capacity",
    },
    "PUT",
  );
  await c.api(`/api/app/incidents/${resolved.id}/report/publish`, {
    channels: [],
  });
  // Leave a real unpublished draft on the active incident.
  const view = (await c.api(`/api/app/incidents/${incident.id}`)).incident;
  const draft = await c.request(`/api/app/incidents/${incident.id}/draft`, {
    method: "PUT",
    headers: { "If-Match": `${view.draft?.id ?? "-"}:${view.updates.length}` },
    json: {
      lifecycle: "Monitoring",
      affectedAudience: "API customers",
      customerImpact: "Private next update",
      whatStillWorks: "Dashboard",
      details: "Never publish this draft during upgrade",
      nextUpdateAt: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(draft.status, 200, await draft.clone().text());
  const maintenance = (
    await c.api("/api/app/maintenance", {
      title: "Retained maintenance",
      startsAt: new Date(Date.now() + 172800000).toISOString(),
      endsAt: new Date(Date.now() + 176400000).toISOString(),
      componentIds: [component.id],
    })
  ).maintenance;
  const channel = (
    await c.api("/api/app/channels", {
      kind: "slack",
      name: "Owner channel",
      url: "https://hooks.slack.com/services/TUPGRADE/BUPGRADE/syntheticSecretOnly",
      componentIds: [component.id],
    })
  ).channel;
  const preset = (
    await c.api("/api/app/intake/sources", {
      name: "Owner monitor",
      preset: "pingdom",
      componentId: component.id,
      credentialKind: "bearer-token",
    })
  ).source;
  const files = await Promise.all(
    (await readdir(join(source, "tests/fixtures/statuspage/small"))).map(
      async (name) => ({
        name,
        text: await readFile(
          join(source, "tests/fixtures/statuspage/small", name),
          "utf8",
        ),
      }),
    ),
  );
  const version = JSON.parse(
    await readFile(join(source, "RELEASE.json"), "utf8"),
  ).version;
  const [major, minor] = version.split(".").map(Number);
  const explicitInvitations = major > 1 || (major === 1 && minor >= 4);
  // From 1.8.0 Move in runs only through the import door.
  const throughDoor = major > 1 || (major === 1 && minor >= 8);
  const beforeImport = mail.length;
  let imported;
  if (throughDoor) {
    const moveIn = moveInDoor(async (path, json, headers = {}) => {
      const response = await c.request(path, json === undefined ? {} : { method: "POST", json, headers });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    });
    const reviewed = await moveIn.preview({ source: "statuspage", files });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    const applied = await moveIn.apply(reviewed.body);
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    imported = applied.body;
  } else {
    const preview = await c.api("/api/app/statuspage-import/preview", { files });
    imported = await c.api("/api/app/statuspage-import/apply", {
      files,
      asOf: preview.report.asOf,
      fingerprint: preview.report.fingerprint,
      acknowledged: true,
    });
  }
  for (
    let n = 0;
    n < 80 &&
    (imported.job.state === "applying" ||
      (!explicitInvitations && imported.invites.remaining > 0));
    n++
  )
    imported = await c.api(
      `/api/app/statuspage-import/jobs/${imported.job.id}/resume`,
      {},
    );
  assert.equal(imported.job.state, "completed");
  if (explicitInvitations) {
    assert.equal(mail.length, beforeImport, "import apply/resume sends no invitations");
    assert.ok(imported.invites.remaining > 0, "import leaves invitations for an explicit owner action");
    for (let n = 0; n < 80 && imported.invites.remaining > 0; n++)
      imported = await c.api(
        `/api/app/statuspage-import/jobs/${imported.job.id}/send-invitations`,
        {},
      );
    assert.ok(mail.length > beforeImport, "the explicit action sends imported subscriber invitations");
  }
  assert.equal(imported.invites.remaining, 0);
  // A provider's ambiguous accepted send cannot be manufactured through a happy
  // path. Seed this legitimate persisted edge state to guard against replay.
  await sql(
    db,
    `INSERT INTO mail_send_ledger(id,envelope_hash,state,created_at,updated_at) VALUES('upgrade-uncertain-send','retained-envelope','uncertain','2026-01-01','2026-01-01'); INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,reason,payload_json,created_at,updated_at) SELECT 'upgrade-audit','component', '${component.id}','updated',id,'Owner annotation','{}','2026-01-01','2026-01-01' FROM operators WHERE email='${owner}'`,
  );
  await settle(mf);
  assert.equal((await c.request("/health")).status, 200);
  const alias = await c.public("/incidents/i0000000001");
  assert.ok([301, 302, 307, 308].includes(alias.status));
  return {
    cookie: c.cookie,
    owner: (await c.api("/api/app/session")).operator,
    group,
    component,
    incident: published,
    resolved,
    maintenance,
    channel,
    preset,
    subscriptions,
    logoKey,
    logo: logo.toString("base64"),
    jobId: imported.job.id,
    alias: { status: alias.status, location: alias.headers.get("location") },
  };
}
