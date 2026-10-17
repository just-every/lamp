// One ordered plan for local serial verification and independent CI machines.
// A shard never shares a mutable build, D1 database or browser with another shard.
export const verificationPlan = {
  source: ['source:copies', 'source:check', 'test:owner-migrations', 'test:operations', 'test:docs', 'test:external-heartbeat', 'typecheck', 'check:syntax', 'validate:release', 'test', 'verify:visual:source'],
  'ownership-upgrade': ['test:operator-readiness:upgrade'],
  'ownership-authority': ['test:operator-readiness:authority'],
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
  'imports-cutover-contract': ['test:move-in:cutover:contract'],
  'imports-cutover-browser': ['test:move-in:cutover:browser'],
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

// Queue the longest observed jobs first so runner limits do not leave a long
// import journey behind the short source/API checks. Keep local verification's
// source-first order above. Timings include bootstrap from Verify 39076537391;
// each split inherits its former group's estimate until CI measures it alone.
const ciDurationSeconds = {
  'imports-betterstack': 503,
  'imports-cutover-browser': 446,
  'imports-cutover-contract': 446,
  baseline: 312,
  'ownership-upgrade': 284,
  'ownership-authority': 284,
  autosave: 274,
  portability: 269,
  delivery: 251,
  storage: 250,
  'imports-instatus': 250,
  adoption: 201,
  'imports-betterstack-browser': 196,
  public: 193,
  notifications: 184,
  publishing: 180,
  'imports-statuspage': 179,
  site: 171,
  composer: 164,
  runtime: 162,
  demo: 135,
  source: 125,
  ingress: 120,
  artifact: 93,
  api: 78,
  'imports-sorry': 74,
};
export const ciShardNames = [...shardNames].sort((a, b) => ciDurationSeconds[b] - ciDurationSeconds[a] || a.localeCompare(b));
