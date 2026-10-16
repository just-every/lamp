import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { verificationPlan, shardNames } from './plan.mjs';

const directory = process.env.LAMP_VERIFICATION_DIRECTORY ?? '.seed/installer/verification/ci-shards';
const expectedCommit = process.env.GITHUB_SHA;
if (!expectedCommit) throw Error('GITHUB_SHA is required to aggregate CI results.');
const runId = process.env.GITHUB_RUN_ID;
const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
if (!/^\d+$/.test(runId ?? '') || !Number.isSafeInteger(runAttempt) || runAttempt < 1) throw Error('GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT are required to aggregate CI results.');
const issues = [], shards = [];
await mkdir(directory, { recursive: true });
// A partial rerun retains untouched shards from earlier attempts. Select the
// newest attempt per shard before validating it; artifact IDs are not ordered
// by creation time, and merging directories can overwrite a newer result.
const latest = new Map();
for (const name of await readdir(directory)) {
  const match = /^lamp-shard-(\d+)-(\d+)-(.+)$/.exec(name);
  const attempt = Number(match?.[2]);
  if (!match || match[1] !== runId || !Number.isSafeInteger(attempt) || attempt < 1 || attempt > runAttempt || !shardNames.includes(match[3])) {
    issues.push(`Unexpected shard artifact: ${name}`);
    continue;
  }
  const shard = match[3];
  if (!latest.has(shard) || latest.get(shard).attempt < attempt) latest.set(shard, { name, attempt });
}
if (process.env.SHARDS_RESULT !== 'success') issues.push('The shard jobs did not all succeed.');
for (const shard of shardNames) {
  try {
    const selected = latest.get(shard);
    if (!selected) throw Error('missing shard artifact');
    const files = await readdir(join(directory, selected.name));
    if (files.length !== 1 || files[0] !== `${shard}.json`) throw Error('unexpected shard artifact contents');
    const record = JSON.parse(await readFile(join(directory, selected.name, `${shard}.json`), 'utf8'));
    if (record.runId !== runId || record.runAttempt !== selected.attempt) throw Error('wrong run or attempt');
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
