import { appendFile, readFile, readdir } from 'node:fs/promises';
import { planVerification } from '../verify-plan.mjs';
import { verificationPlan, ciShardNames } from '../verification/plan.mjs';
import { lampLightReaders } from './readers.mjs';

// Scheduling remains owned by Lamp's local verifier. Base owns evidence
// identity, newest-attempt selection, merge-tree comparison and reuse policy.
export async function lampPlan() {
  const { scripts } = JSON.parse(await readFile('package.json', 'utf8'));
  const baseline = (await readdir('tests/baseline/e2e-baseline'))
    .filter(name => name.endsWith('.test.mjs')).map(name => `tests/baseline/e2e-baseline/${name}`);
  return {
    push: ciShardNames.map(name => ({
      name, browser: name !== 'portability', hosted: name === 'runtime',
      commands: verificationPlan[name].map(script => script === 'test:baseline'
        ? `node --test --test-concurrency=1 ${[...baseline, 'tests/e2e/accessibility.test.mjs'].join(' ')}`
        : scripts[script]),
    })),
    // release.yml retains the three nightly installation journeys. Its tag and
    // manual entries also call Verify with tier=all; schedules run only those
    // nightly journeys, without duplicating the push matrix.
    nightly: [],
  };
}

if (process.argv[1] === import.meta.filename) {
  const decision = await planVerification({ plan: await lampPlan(), readers: lampLightReaders });
  const output = Object.entries({ ...decision, matrix: JSON.stringify(decision.matrix),
    readers: JSON.stringify(decision.readers), shards: JSON.stringify(decision.matrix.include.map(shard => shard.name)),
    has_shards: decision.matrix.include.length > 0 }).map(([key, value]) => `${key}=${value}\n`).join('');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
