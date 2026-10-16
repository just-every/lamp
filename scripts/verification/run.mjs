import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verificationPlan, shardNames } from './plan.mjs';
import { checkVerificationPlan } from './check-plan.mjs';

checkVerificationPlan();

const requested = process.argv[2] ?? process.env.LAMP_VERIFY_SHARD;
if (process.argv.length > 3 || (requested && !shardNames.includes(requested))) throw Error(`Usage: node scripts/verification/run.mjs [${shardNames.join('|')}]`);
const selected = requested ? [requested] : shardNames;
const directory = process.env.LAMP_VERIFICATION_DIRECTORY ?? '.seed/installer/verification/ci-shards';
await mkdir(directory, { recursive: true });
let failed = false;
for (const shard of selected) {
  const record = { shard, commit: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 0), success: false, steps: [] };
  const path = join(directory, `${shard}.json`);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  // Continue after a failed gate so the first run retains every independent result.
  for (const script of verificationPlan[shard]) {
    const started = Date.now();
    console.log(`\nVerifying ${shard}: ${script}`);
    const result = await new Promise(resolve => {
      const child = spawn('pnpm', ['run', script], { stdio: 'inherit', env: process.env });
      child.once('error', error => resolve({ exitCode: 1, error: error.message }));
      child.once('exit', (code, signal) => resolve({ exitCode: code ?? 1, ...(signal ? { signal } : {}) }));
    });
    record.steps.push({ script, ...result, durationMs: Date.now() - started });
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  }
  record.success = record.steps.every(step => step.exitCode === 0);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
  failed ||= !record.success;
}
if (failed) process.exitCode = 1;
