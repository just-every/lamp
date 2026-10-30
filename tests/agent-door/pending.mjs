// Reproduced 2026-10-30 on published rer 0.2.93. These are active failures:
// neither the descriptor nor the baseline collector skips or credits a point.
export const pendingBaseAssertions = [{
  family: 'injectionAfterMutation',
  points: ['BASE-AGENT-005.5.autonomous.incident-publish'],
  source: 'modules/agent-door/conformance/injection.mjs:21-23; modules/agent-door/conformance/protocol.mjs:129-132',
  ruling: 'C6',
  writer: null,
  reason: 'The injection probe allocates a new mutation key after publication has consumed its native draft. Reusing the old draft revision correctly refuses the second publication.',
}];
