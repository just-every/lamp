import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

async function main() {
  const record = JSON.parse(await readFile('.seed/deployment/lamp-status.json', 'utf8'));
  if (record.appHost !== 'status-app.run-lamp.com' || record.pageHost !== 'status.run-lamp.com') {
    throw new Error('The retained record does not belong to Lamp status.');
  }
  for (const name of ['SESSION_SECRET', 'LAMP_STATUS_MONITOR_TOKEN']) {
    if (!process.env[name] || process.env[name].length < 32) throw new Error(`${name} is required.`);
  }
  for (const name of ['SETUP_OPERATOR_EMAIL', 'MAIL_FROM_ADDRESS']) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env[name] ?? '')) throw new Error(`${name} is required.`);
  }
  const directory = await mkdtemp(join(tmpdir(), 'lamp-status-monitor-'));
  try {
    const config = join(directory, 'wrangler.json');
    const secrets = join(directory, 'secrets.json');
    await writeFile(config, JSON.stringify({
      name: 'lamp-status-checks', main: resolve('scripts/lamp-status/worker.mjs'),
      account_id: record.accountId, compatibility_date: '2026-09-08',
      compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'], workers_dev: false,
      routes: [{ pattern: 'status-checks.run-lamp.com', custom_domain: true }],
      triggers: { crons: ['*/5 * * * *'] },
      d1_databases: [{ binding: 'DB', database_name: record.resources.database, database_id: record.resources.databaseId }],
      observability: { enabled: true },
    }), { mode: 0o600 });
    await writeFile(secrets, JSON.stringify({ SESSION_SECRET: process.env.SESSION_SECRET,
      LAMP_STATUS_MONITOR_TOKEN: process.env.LAMP_STATUS_MONITOR_TOKEN,
      SETUP_OPERATOR_EMAIL: process.env.SETUP_OPERATOR_EMAIL,
      MAIL_FROM_ADDRESS: process.env.MAIL_FROM_ADDRESS }), { mode: 0o600 });
    const deployed = spawnSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', config, '--secrets-file', secrets], { stdio: 'inherit' });
    if (deployed.status !== 0) throw new Error('The HTTP check Worker could not be deployed.');
    const origin = 'https://status-checks.run-lamp.com';
    let ready = false;
    for (const deadline = Date.now() + 180000; Date.now() < deadline;) {
      const response = await fetch(origin + '/health', { signal: AbortSignal.timeout(10000) }).catch(() => null);
      ready = response?.ok ?? false;
      await response?.body?.cancel();
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (!ready) throw new Error('The deployed HTTP check Worker is not publicly reachable yet.');
    const result = await fetch(origin + '/run?prove=true', {
      method: 'POST', signal: AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${process.env.LAMP_STATUS_MONITOR_TOKEN}` },
    });
    if (!result.ok) throw new Error(`The initial real checks failed (HTTP ${result.status}): ${(await result.json().catch(() => null))?.error ?? 'no reason given'}`);
    const measured = await result.json();
    await mkdir('lamp-status-results', { recursive: true });
    await writeFile('lamp-status-results/checks.json', JSON.stringify(measured, null, 2) + '\n');
    console.log(JSON.stringify(measured, null, 2));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
