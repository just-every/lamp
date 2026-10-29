import { lightReaders } from '../verify-light.mjs';

// Reviewed Lamp test readers: these journeys consume application code,
// fixtures, seed.json, BASELINE.md or built assets, and do not semantically read
// Base's permitted light documents or evidence directories. Keep this explicit:
// a newly scheduled test must select full coverage until its readers are known.
const reviewed = [
  'tests/e2e/auth-adoption-journey.test.mjs',
  'tests/auth-adoption/dependencies.test.mjs',
  'tests/auth-adoption/upgrade.test.mjs',
  'tests/demo/owner-claim.test.mjs',
  'tests/e2e/export-import.test.mjs',
  'tests/auth-adoption/portability.test.mjs',
  'tests/e2e/page-data.test.mjs',
  'tests/e2e/prior-backup.test.mjs',
  'tests/e2e/statuspage-import.test.mjs',
  'tests/e2e/cutover-browser.test.mjs',
  'tests/e2e/sorry-import.test.mjs',
  'tests/e2e/rer-mail.test.mjs',
  'tests/lamp-site/browser.test.mjs',
  'tests/e2e/website-onboarding.test.mjs',
  'tests/e2e/publishing-browser.test.mjs',
  'tests/e2e/maintenance-timezone.test.mjs',
  'tests/e2e/public-contract.test.mjs',
  'tests/e2e/snapshot-retained.test.mjs',
  'tests/e2e/channels-and-presets.test.mjs',
  'tests/e2e/delivery-contract.test.mjs',
  'tests/e2e/start-runtime.test.mjs',
  'tests/e2e/independent-release.test.mjs',
  'tests/e2e/publishing-contract.test.mjs',
  'tests/e2e/incident-brief.test.mjs',
  'tests/e2e/update-reminders.test.mjs',
  'tests/demo/journey.test.mjs',
  'tests/baseline/e2e-baseline/core-baseline.test.mjs',
  'tests/e2e/accessibility.test.mjs',
];

export async function lampLightReaders(files, options) {
  const commands = await lightReaders(files, { ...options,
    plan: { ...options.plan, readers: Object.fromEntries(reviewed.map(path => [path, []])) } });
  if (!commands) return;
  if (files.includes('CONTRACT.md')) commands.push(
    'node scripts/verification/check-plan.mjs',
    'node scripts/validate-release.mjs',
    'node scripts/baseline/reporter-probes.mjs',
  );
  return commands;
}
