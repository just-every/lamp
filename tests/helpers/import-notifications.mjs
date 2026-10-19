import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getPlatformProxy } from 'wrangler';
import { load } from '../operator-readiness/runtime.mjs';
import { authFixture } from '../auth-adoption/runtime.mjs';

// Ordinary dev suppresses mail. Observe the durable work and invitation claims
// instead of a captured-message viewer. Undo may delete rows, but must add none.
export async function notificationActivity(runtime) {
  const query = `SELECT 'outbox' AS kind,id FROM notification_outbox
    UNION ALL SELECT 'delivery',id FROM notification_deliveries
    UNION ALL SELECT 'invitation',subscriber_id || ':' || sent_at
      FROM statuspage_import_invites WHERE sent_at IS NOT NULL ORDER BY kind,id`;
  const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB',
    '--local', '--config', 'wrangler.jsonc', '--persist-to', runtime.state,
    '--json', '--command', query], { env: runtime.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output)[0].results.map(row => `${row.kind}:${row.id}`);
}

export async function assertNoNewNotifications(runtime, before, message = 'import sends and queues no notifications') {
  const prior = new Set(before);
  assert.deepEqual((await notificationActivity(runtime)).filter(row => !prior.has(row)), [], message);
}

// Exercise hosted invitation effects on the SAME imported D1 data. Pause Vite
// while a binding proxy owns its persisted store. The real owner middleware,
// import route, subscriber tokens and Resend serializer run; only Resend's paid
// HTTP boundary is faked. Restart Vite so the emitted link can be opened there.
export async function sendImportedInvitations(t, runtime, { origin, publicOrigin, operator, jobId }) {
  await runtime.stop();
  let platform, provider;
  try {
    platform = await getPlatformProxy({ configPath: runtime.env.LAMP_WRANGLER_CONFIG ?? 'wrangler.jsonc',
      remoteBindings: false, persist: { path: join(runtime.state, 'v3') } });
    const db = platform.env.DB;
    const [modules, { ResendMailSender }] = await Promise.all([
      load('tests/auth-adoption/adapter.ts'), load('src/core/platform/mail/resend.ts'),
    ]);
    const page = await db.prepare("SELECT page_name,mail_from_address FROM page_settings WHERE id='default'").first();
    const base = authFixture(db, { origin, owner: operator });
    const cookie = await base.signIn();
    const messages = [], fetcher = globalThis.fetch;
    provider = t.mock.method(globalThis, 'fetch', async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.origin === 'https://api.resend.com' && url.pathname === '/emails') {
        const message = await request.json();
        messages.push({ message: { ...message, to: message.to[0] } });
        return Response.json({ id: `import-invitation-${messages.length}` });
      }
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return fetcher(input, init);
      throw new Error('The import invitation proof forbids external network');
    });
    const subscribers = modules.createSubscribersService(modules.createSubscriberRepository(db), {
      mail: new ResendMailSender({ apiKey: 'test-only-resend-key', fromAddress: page.mail_from_address }),
      fromAddress: page.mail_from_address, tokenSecret: runtime.env.SESSION_SECRET,
    });
    const app = new Hono();
    app.use('/api/app/*', modules.requireOperator(() => base.auth));
    modules.registerStatuspageImportRoutes(app, modules.createStatuspageImportService(db, {
      inviteSubscriber: (id, claim) => subscribers.inviteImported(id, publicOrigin, page.page_name, claim),
      async publicDataChanged() { throw new Error('Sending invitations must not publish imported history'); },
    }));
    const send = () => app.fetch(base.request(`/api/app/statuspage-import/jobs/${jobId}/send-invitations`,
      { method: 'POST', cookie, body: {} }), { DB: db });
    const response = await send();
    const invited = { status: response.status, body: await response.json() };
    const repeated = await send();
    assert.equal(repeated.status, 200, 'repeating the owner action succeeds without another handoff');
    return { invited, messages };
  } finally {
    provider?.mock.restore();
    try { await platform?.dispose(); } finally { await runtime.start(); }
  }
}

/** Move in's transport, exactly as the screen drives it: saved responses (read
 * from a key or public page first when none are chosen) upload to the import
 * door's owner surface, plan, apply the reviewed fingerprint and undo, each
 * request naming its source. `send(path, body, headers)` makes the signed-in
 * owner's same-origin request (GET without a body) and returns {status, body}. */
export function moveInDoor(send) {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const door = (source, action, body) => send(`/api/operator/import/${action}`, body, { 'X-Import-Source': source });
  const read = id => send(`/api/app/statuspage-import/jobs/${encodeURIComponent(id)}`);
  async function until(source, action, body, working) {
    let response;
    for (let round = 0; round < 1000; round++) {
      response = await door(source, action, body);
      if (response.status !== 200 || !working.includes(response.body.job?.state)) break;
    }
    return response;
  }
  const sourceOf = reviewed => reviewed.source ?? reviewed.namespace ?? 'statuspage';
  return {
    door, read,
    /** The dry run: the door's plan with Move in's report, and the fetched responses. */
    async preview({ source = 'statuspage', files, pageId = '', apiKey, publicUrl, publicAccessAcknowledged = false }) {
      let fetched;
      if (!files?.length) {
        const response = await send('/api/app/statuspage-import/fetch', { source, publicAccessAcknowledged, pageId, ...(source === 'sorry' && publicUrl ? { publicUrl } : {}), apiKey });
        if (response.status !== 200) return response;
        fetched = response.body.files;
      }
      const upload = { source, files: fetched ?? files, pageId, publicAccessAcknowledged, ...(source === 'sorry' && publicUrl ? { publicUrl } : {}) };
      for (let attempt; ;) {
        const bytes = Buffer.from(JSON.stringify(attempt ? { ...upload, attempt } : upload));
        const totalChunks = Math.ceil(bytes.length / 65536);
        let uploadId;
        for (let index = 0; index < totalChunks; index++) {
          const chunk = bytes.subarray(index * 65536, (index + 1) * 65536);
          const uploaded = await door(source, 'uploads', { ...(uploadId ? { uploadId } : {}), name: `${source}-move-in.json`, bundleSha256: hash(bytes), totalBytes: bytes.length, totalChunks, index, chunkSha256: hash(chunk), base64: chunk.toString('base64') });
          if (uploaded.status !== 200) return uploaded;
          uploadId = uploaded.body.uploadId;
        }
        let planned = await door(source, 'plan', { uploadId });
        if (planned.status === 409 && planned.body.error === 'catchup_required') planned = await door(source, 'plan', { uploadId, catchup: true });
        // A source imported and undone is uploaded afresh, as the server asks.
        if (planned.status === 409 && planned.body.error === 'import_undone_upload_again') { attempt = planned.body.details.attempt; continue; }
        return planned.status === 200 ? { status: 200, body: { ...planned.body, source, ...(fetched ? { files: fetched } : {}) } } : planned;
      }
    },
    /** Applies a reviewed plan in bounded steps until it finishes, then reads the import. */
    async apply(reviewed, fingerprint = reviewed.fingerprint) {
      const applied = await until(sourceOf(reviewed), 'apply', { planId: reviewed.planId, reviewedFingerprint: fingerprint }, ['queued', 'applying']);
      return applied.status === 200 ? read(applied.body.job.id) : applied;
    },
    /** Undoes a door import (a history row, or a result's `door`) until it finishes, then reads it. */
    async undo(job) {
      const undone = await until(sourceOf(job), 'undo', { planId: job.planId }, ['undoing']);
      return undone.status === 200 ? read(undone.body.job.id) : undone;
    },
  };
}
