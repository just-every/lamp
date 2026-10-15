import { spawnSync } from 'node:child_process';
// The complete owner snapshot is already exercised by test:publishing-browser.
// This second, distinct case proves a compiled heading edit for an ordinary owner.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern=compiled visual edits', 'tests/e2e/publishing-browser.test.mjs'], {
  stdio: 'inherit', env: { ...process.env, RER_VISUAL_HEADING_PROBE: '1' },
});
process.exitCode = result.status ?? 1;
