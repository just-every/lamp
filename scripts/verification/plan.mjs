// Local verification and CI execute the same commands. Production output is
// built once, then each journey gets its own database, runtime and browser.
export const verificationPlan = {
  build: ['source:copies', 'source:check', 'typecheck', 'check:syntax', 'validate:release', 'verify:visual:source', 'build:app', 'build:site'],
  ownership: ['test:ownership', 'test:owner-claim', 'test:owner-backup'],
  portability: ['test:portability'],
  imports: ['test:imports', 'test:mail', 'test:site'],
  composer: ['test:composer', 'test:public'],
  delivery: ['test:channels'],
  public: ['test:delivery'],
  runtime: ['test:runtime', 'test:publishing'],
  demo: ['test:demo', 'test:baseline'],
};
export const shardNames = Object.keys(verificationPlan);
// The separate build job contributes its own commit-bound completion record.
export const ciShardNames = shardNames.filter(name => name !== 'build');
