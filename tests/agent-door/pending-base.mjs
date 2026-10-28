import assert from 'node:assert/strict';

// Dated assertions remain live. Re-pinning must satisfy them; this module never
// skips, weakens or converts their failure into a passing result.
export const pendingBase = Object.freeze({
  nativeTarget: 'PENDING BASE hooks-8/8b, 2026-10-28: audit native target attribution',
  resourceCode: 'PENDING BASE hooks-8/8b, 2026-10-28: resource JSON-RPC data.code',
  replayAuthority: 'PENDING BASE hooks-6, 2026-10-28: native authorization before mutation replay',
  escalationSurface: 'PENDING BASE hooks-7, 2026-10-28: applicable resource/security escalation fixtures',
  reviewerLifecycle: 'PENDING BASE hooks-7, 2026-10-28: real reviewer lifecycle',
});
export function assertNativeTarget(row, target) { assert.equal(row.resource, target, pendingBase.nativeTarget); }
export function assertResourceCode(answer, code) { assert.equal(answer.error?.data?.code, code, pendingBase.resourceCode); }
