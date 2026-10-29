import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export async function verificationPlan() {
 const plan = JSON.parse(await readFile(new URL('../verification.json', import.meta.url), 'utf8'));
 const names = new Set();
 for (const tier of ['push', 'nightly']) {
  if (!Array.isArray(plan[tier])) throw Error(`Missing verification tier: ${tier}`);
  for (const shard of plan[tier]) {
   if (!/^[a-z][a-z0-9-]*$/.test(shard.name) || names.has(shard.name)) throw Error(`Invalid or duplicate shard: ${shard.name}`);
   if (typeof shard.browser !== 'boolean' || typeof shard.hosted !== 'boolean' || !Array.isArray(shard.commands) || !shard.commands.length || shard.commands.some(command => typeof command !== 'string' || !command.trim())) throw Error(`Incomplete shard: ${shard.name}`);
   names.add(shard.name);
  }
 }
 if (!plan.push.length || plan.push.filter(shard => shard.hosted).length !== 1) throw Error('Push verification must include the hosted production build');
 return plan;
}

export function run(command, env = process.env) {
 console.log(`> ${command}`);
 const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', command], { stdio: 'inherit', env });
 if (result.error) throw result.error;
 if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] === import.meta.filename) {
 const plan = await verificationPlan();
 const all = [...plan.push, ...plan.nightly];
 const selected = process.env.SEED_VERIFY_SHARD;
 const shards = selected ? all.filter(shard => shard.name === selected) : all;
 if (!shards.length) throw Error(`Unknown verification shard: ${selected}`);
 for (const shard of shards) for (const command of shard.commands) run(command);
}
