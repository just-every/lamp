import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { verificationPlan, shardNames } from './plan.mjs';

const directory = process.env.LAMP_VERIFICATION_DIRECTORY ?? '.seed/installer/verification/ci-shards';
const expectedCommit = process.env.GITHUB_SHA;
if (!expectedCommit) throw Error('GITHUB_SHA is required to aggregate CI results.');
const issues = [], shards = [];
await mkdir(directory, { recursive: true });
for (const name of await readdir(directory)) if (name.endsWith('.json') && !shardNames.includes(name.slice(0, -5))) issues.push(`Unexpected shard receipt: ${name}`);
for (const shard of shardNames) {
  try {
    const record = JSON.parse(await readFile(join(directory, `${shard}.json`), 'utf8'));
    if (record.shard !== shard || record.commit !== expectedCommit || record.success !== true) throw Error('wrong shard, commit or unsuccessful completion');
    if (JSON.stringify(record.steps?.map(step => step.script)) !== JSON.stringify(verificationPlan[shard])) throw Error('planned steps did not all execute exactly once');
    if (record.steps.some(step => step.exitCode !== 0)) throw Error('a verification step failed');
    shards.push(record);
  } catch (error) { issues.push(`${shard}: ${error.message}`); }
}
const summary = { commit: expectedCommit, success: !issues.length, issues, shards };
await writeFile(join(dirname(directory), 'ci-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
for (const issue of issues) console.error(issue);
console.log(`Verification: ${shards.length}/${shardNames.length} shards completed successfully for this commit.`);
if (issues.length) process.exitCode = 1;
