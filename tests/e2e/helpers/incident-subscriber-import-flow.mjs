import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { notificationActivity, assertNoNewNotifications, sendImportedInvitations } from "../../helpers/import-notifications.mjs";

/** Extends the existing MOVE-002 journey with unchanged, synthetic Statuspage
 * incident-subscriber responses, through Move in's public upload/plan doors. */
export function incidentSubscriberFiles(original) {
  const files = original.map(file => ({ ...file, text: file.text.replaceAll("i000000000", "followinc00").replaceAll("c000000000", "followcomp").replaceAll("https://stspg.io/", "https://stspg.io/follow-") }));
  const incidentFile = files.find(file => file.name === "incidents.json");
  const incidents = JSON.parse(incidentFile.text);
  incidents[0].name = "Unresolved incident with followers";
  incidents[0].status = "investigating";
  incidents[0].resolved_at = null;
  incidents[0].incident_updates = incidents[0].incident_updates.filter(update => update.status !== "resolved");
  incidentFile.text = JSON.stringify(incidents);
  files.find(file => file.name === "subscribers.json").text = JSON.stringify([{ id: "shared-page-subscriber", mode: "email", email: "synthetic-lamp-import-follower@example.test", components: [] }]);
  files.push({ name: `incident-subscribers-${incidents[0].id}.json`, text: JSON.stringify([
    { id: "shared-incident-subscriber", mode: "email", email: "synthetic-lamp-import-follower@example.test", incident_id: incidents[0].id },
    { id: "quarantined-incident-subscriber", mode: "email", email: "synthetic-lamp-quarantined@example.test", quarantined_at: "2026-10-01T00:00:00.000Z" },
    { id: "phone-incident-subscriber", mode: "sms", email: null },
  ]) });
  files.push({ name: `incident-subscribers-${incidents[1].id}.json`, text: JSON.stringify([{ id: "resolved-incident-subscriber", mode: "email", email: "synthetic-lamp-resolved@example.test" }]) });
  return files;
}

export async function incidentSubscriberImportFlow({ t, runtime, api, moveIn, importAll, original, origin, publicOrigin, operator }) {
  const before = (await api("/api/app/subscribers?limit=100")).body.subscribers;
  const activity = await notificationActivity(runtime);
  const files = incidentSubscriberFiles(original);
  const preview = await moveIn.preview({ files });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.report.counts.subscriber.imported, 2, "one page subscription and one distinct incident subscription share the same address");
  assert.equal(preview.body.report.counts.subscriber.skipped, 3, "resolved, quarantined and unsupported incident subscribers are named and skipped");
  assert.equal((await api("/api/app/subscribers?limit=100")).body.subscribers.length, before.length, "dry run stores no incident followers");
  const { result } = await importAll(files);
  const subscribers = (await api("/api/app/subscribers?limit=100")).body.subscribers.filter(row => row.destination === "synthetic-lamp-import-follower@example.test");
  assert.equal(subscribers.length, 2);
  assert.ok(subscribers.every(row => row.state === "pending"), "neither source consent nor import silently activates a subscription");
  const incident = (await api("/api/app/incidents")).body.incidents.find(row => row.title === "Unresolved incident with followers");
  const follower = subscribers.find(row => row.incident?.id === incident.id);
  assert.ok(follower, "operator list retains the exact imported incident scope");
  assert.equal(subscribers.filter(row => !row.incident).length, 1, "the page subscription retains its independent scope");
  await assertNoNewNotifications(runtime, activity, "applying incident followers sends no replay or invitation");
  const tokensForFollower = () => JSON.parse(execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", runtime.state, "--json", "--command", `SELECT COUNT(*) AS count FROM subscriber_tokens WHERE subscriber_id='${follower.id}'`], { env: runtime.env, stdio: "pipe" }).toString())[0].results[0].count;
  assert.equal(tokensForFollower(), 0, "silent import creates no confirmation authority");
  const repeatedPublicPost = await fetch(publicOrigin + "/subscribe/incident", { method: "POST", headers: { Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin" }, body: new URLSearchParams({ incidentId: incident.id, channel: "email", email: follower.destination }) });
  assert.equal(repeatedPublicPost.status, 202, await repeatedPublicPost.clone().text());
  assert.match(await repeatedPublicPost.text(), /Check your inbox/u);
  assert.equal(tokensForFollower(), 0, "a repeated public POST cannot bypass the owner's import invitation or mint a confirmation token");
  const invited = await sendImportedInvitations(t, runtime, { origin, publicOrigin, operator, jobId: result.job.id });
  assert.equal(invited.invited.status, 200, JSON.stringify(invited.invited.body));
  assert.equal(invited.invited.body.invites.sent, 2, "only the owner's explicit action sends one invitation per pending subscription");
  assert.equal(invited.messages.length, 2, "repeating the action sends nothing twice");
  assert.ok(invited.messages.every(row => row.message.to === "synthetic-lamp-import-follower@example.test"));
  const activityAfterInvitations = await notificationActivity(runtime);
  const undone = await moveIn.undo(result.door);
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  assert.equal(undone.body.job.state, "undone");
  assert.equal((await api("/api/app/subscribers?limit=100")).body.subscribers.length, before.length, "undo removes both pending subscriptions and their incident sidecar");
  await assertNoNewNotifications(runtime, activityAfterInvitations, "undo sends no incident notification");
}
