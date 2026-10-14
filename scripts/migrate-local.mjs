import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { applyOwnerMigrations } from './owner-migrations.mjs';

// Capture the complete core + owner command as a child so shared owner migration
// tooling retains its own output and failure semantics without local alterations.
const verbose = process.argv.includes('--verbose');
if (!process.argv.includes('--apply')) {
  const result = spawnSync(process.execPath, ['scripts/migrate-local.mjs', '--apply'], { encoding: 'utf8', stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    if (!verbose) process.stderr.write(result.stderr || result.stdout || 'Local migrations failed.\n');
    process.exitCode = result.status ?? 1;
  } else console.log('Local database migrations are up to date.');
} else {
  const persistence = resolve(process.env.RER_STATE_DIR ?? process.env.LAMP_WORKERS_STATE_PATH ?? '.wrangler/state');
  const result = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistence, '--config', 'wrangler.jsonc'], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else await applyOwnerMigrations('wrangler.jsonc', ['--local', '--persist-to', persistence]);
}
