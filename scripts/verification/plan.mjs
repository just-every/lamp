// One ordered plan for local serial verification and independent CI machines.
// A shard never shares a mutable build, D1 database or browser with another shard.
export const verificationPlan = {
  source: ['source:copies', 'source:check', 'test:owner-migrations', 'test:operations', 'test:docs', 'test:external-heartbeat', 'typecheck', 'check:syntax', 'validate:release', 'test', 'verify:visual:source'],
  ownership: ['test:operator-readiness'],
  adoption: ['test:rer-journey'],
  demo: ['test:demo'],
  storage: ['test:reference-storage', 'test:public-snapshots', 'test:resolve-composer', 'test:workflow-render'],
  ingress: ['test:dev-ingress'],
  publishing: ['test:publishing'],
  api: ['test:api'],
  portability: ['test:export-import'],
  composer: ['test:publishing-browser', 'verify:visual:heading'],
  autosave: ['test:ui-interactions', 'test:maintenance-timezone', 'test:autosave-integrity'],
  delivery: ['test:delivery'],
  public: ['test:public'],
  baseline: ['test:baseline'],
  'imports-cutover': ['test:move-in:cutover'],
  'imports-statuspage': ['test:move-in:statuspage'],
  'imports-betterstack': ['test:move-in:betterstack:contract'],
  'imports-betterstack-browser': ['test:move-in:betterstack:browser'],
  'imports-instatus': ['test:move-in:instatus'],
  'imports-sorry': ['test:move-in:sorry'],
  notifications: ['test:extensions', 'test:intake-references', 'test:channels-and-presets', 'test:incident-brief', 'test:update-reminders'],
  artifact: ['test:deployment-artifact', 'test:independent-packaging', 'test:installer'],
  runtime: ['build:app', 'test:start-runtime:built', 'test:independent-runtime'],
  site: ['test:lamp-site'],
};

export const shardNames = Object.keys(verificationPlan);
