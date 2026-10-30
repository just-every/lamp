// Verification boundaries on published rer 0.2.94. No marker skips, credits,
// relabels or suppresses a conformance point. Full clause judgments stay partial.
export const pendingBaseAssertions = [{
  family: 'failedQueueProducer',
  source: 'cli/agent-door.mjs:73; cli/hosted-output.mjs:120,182; modules/agent-door/ADOPTING.md:773',
  reason: 'The hosted verifier installs healthy native producers and exposes consumer hold/release only. verification.queues has no implementation in rer 0.2.94. Native failed webhook dispatch retry/dismissal is exercised separately; no failed JOBS.send is claimed.',
}, {
  family: 'coreEventBaseline',
  source: 'modules/agent-door/conformance/subset.mjs:17-39; tests/baseline/e2e-baseline/agent-door.test.mjs:49',
  reason: 'CORE refuses undeclared event operations with active BASE-AGENT-subset points, but the installed verifier emits no numbered BASE-AGENT-010 points. The baseline nonempty-points assertion remains active and failing; events are not claimed or relabelled.',
}, {
  family: 'timedAndQueuedFinalAdmission',
  source: 'modules/agent-door/ADOPTING.md:773; cli/agent-history.mjs:61',
  reason: 'CORE does not declare timedLifecycle or queuedLifecycle. Insert-only due-draft history proves native Cron publication and replay, not agent execution-time admission. The broader source branch’s due-dispatch tools are absent from the supplied CORE base.',
}];
