import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Ordinary dev suppresses mail. Observe the durable work and invitation claims
// instead of a captured-message viewer. Undo may delete rows, but must add none.
export async function notificationActivity(runtime) {
  const query = `SELECT 'outbox' AS kind,id FROM notification_outbox
    UNION ALL SELECT 'delivery',id FROM notification_deliveries
    UNION ALL SELECT 'invitation',subscriber_id || ':' || sent_at
      FROM statuspage_import_invites WHERE sent_at IS NOT NULL ORDER BY kind,id`;
  if (runtime.db) return (await runtime.db.prepare(query).all()).results.map(row => `${row.kind}:${row.id}`);
  const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB',
    '--local', '--config', 'wrangler.jsonc', '--persist-to', runtime.state,
    '--json', '--command', query], { env: runtime.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output)[0].results.map(row => `${row.kind}:${row.id}`);
}

export async function assertNoNewNotifications(runtime, before, message = 'import sends and queues no notifications') {
  const prior = new Set(before);
  assert.deepEqual((await notificationActivity(runtime)).filter(row => !prior.has(row)), [], message);
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
