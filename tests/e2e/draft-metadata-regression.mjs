import {hashToken} from '@runeditrun/rer/internal/modules/operator-auth/crypto.mjs';
import {secret} from '../auth-adoption/runtime.mjs';
import {randomBytes} from 'node:crypto';
import assert from "node:assert/strict";
import { sessionCookieName } from "../helpers/session-cookie.mjs";

// The existing correction journey supplies a genuinely consumed draft version
// and its next saved draft. All decisions below pass through the native Worker
// and D1; only authentication fixtures are inserted directly.
export async function assertDraftMetadataIsolation({ baseUrl, appFetch, incidentView, executeFixtureSql, incidentId, consumedVersion, targetUpdateId }) {
  const reviewerId = "01J00000000000000000000701";
  const reviewerSession = randomBytes(32).toString('base64url');
  const sessionHash=await hashToken(secret,'session',reviewerSession),now=Date.now();
  executeFixtureSql(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES ('${reviewerId}','reviewer@example.test','Draft Reviewer','owner','active',${now});
    INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,created_at,expires_at) VALUES ('reviewer-session','${sessionHash}','${reviewerId}',1,'native',${now},${now+86400000})`);
  const before = await incidentView(incidentId);
  assert.notEqual(before.draft.authorOperatorId, reviewerId);
  const version = `${before.draft.id}:${before.updates.length}`;
  const reviewerHeaders = { Cookie: `${sessionCookieName(baseUrl)}=${reviewerSession}` };
  // Bypass the acknowledged-version test client only to send an actually
  // missing header. All explicit valid/stale headers below pass through intact.
  const nativeRequest = (path, body, expectedVersion) => fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Origin:baseUrl, Connection: "close", "Content-Type": "application/json", ...reviewerHeaders, ...(expectedVersion === undefined ? {} : { "If-Match": expectedVersion }) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const [action, body] of [["review", undefined], ["correction", { updateId: targetUpdateId }]]) {
    const path = `/api/app/incidents/${incidentId}/draft/${action}`;
    assert.equal((await nativeRequest(path, body)).status, 428);
    assert.equal((await nativeRequest(path, body, "malformed")).status, 400);
    // A request created for the consumed update cannot stamp the next one;
    // neither half of the native precondition may be ignored independently.
    for (const staleVersion of [consumedVersion, `${before.draft.id}:${before.updates.length - 1}`, `${consumedVersion.split(":")[0]}:${before.updates.length}`]) {
      const response = await appFetch(path, { method: "POST", headers: { ...reviewerHeaders, "If-Match": staleVersion }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, 409);
      const unchanged = await incidentView(incidentId);
      assert.deepEqual(unchanged.draft, before.draft, "rejected metadata writes preserve draft identity, bytes, timestamps and workflow metadata");
      assert.deepEqual(unchanged.updates, before.updates);
    }
  }
  const selfReview = await appFetch(`/api/app/incidents/${incidentId}/draft/review`, { method: "POST", headers: { "If-Match": version } });
  assert.equal(selfReview.status, 409);
  assert.deepEqual((await incidentView(incidentId)).draft, before.draft);
  const review = await appFetch(`/api/app/incidents/${incidentId}/draft/review`, { method: "POST", headers: { ...reviewerHeaders, "If-Match": version } });
  assert.equal(review.status, 200);
  const reviewed = await incidentView(incidentId);
  assert.equal(reviewed.draft.reviewedByOperatorId, reviewerId);
  assert.ok(Number.isFinite(Date.parse(reviewed.draft.reviewedAt)));
  assert.deepEqual(reviewed.draft, { ...before.draft, reviewedByOperatorId: reviewerId, reviewedAt: reviewed.draft.reviewedAt, updatedAt: reviewed.draft.reviewedAt });
  assert.deepEqual(reviewed.updates, before.updates);
  return reviewed;
}
