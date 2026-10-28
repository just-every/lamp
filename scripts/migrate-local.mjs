import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { applyOwnerMigrations } from './owner-migrations.mjs';

// Stream the core + owner command so a growing migration history cannot exhaust
// spawnSync's output buffer. Retain a bounded diagnostic tail on failure.
const verbose = process.argv.includes('--verbose');
if (!process.argv.includes('--apply')) {
  const child = spawn(process.execPath, ['scripts/migrate-local.mjs', '--apply'], { stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  const capture = chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-128 * 1024); };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const code = await new Promise(resolve => {
    child.once('error', error => { capture(error.message); resolve(1); });
    child.once('exit', code => resolve(code ?? 1));
  });
  if (code !== 0) {
    if (!verbose) process.stderr.write(diagnostic || 'Local migrations failed.\n');
    process.exitCode = code;
  } else console.log('Local database migrations are up to date.');
} else {
  const persistence = resolve(process.env.RER_STATE_DIR ?? process.env.LAMP_WORKERS_STATE_PATH ?? '.wrangler/state');
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence, '--config', 'wrangler.jsonc'], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else await applyOwnerMigrations('wrangler.jsonc', ['--local', '--persist-to', persistence]);
}
