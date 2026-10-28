import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { checkout } from '../helpers/native-transfer.mjs';
import { fixtureProcessEnv } from '../helpers/worker-environment.mjs';

const execute = promisify(execFile);

// Owner SQL uses Lamp's declared migration and technical-archive commands. The
// native rer archive journey separately exercises installation identity and
// temporary authority; neither test substitutes an internal helper for the CLI.
test('HIST-004 PORT-001 — owner SQL rolls back a failed upgrade, recovers once, and travels through a clean technical backup and restore', { timeout: 600_000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'lamp-owner-archive-'));
  const installation = join(temporary, 'installation');
  const source = join(installation, '.wrangler/state'), target = join(temporary, 'restored-state');
  const archive = join(temporary, 'archive'), reexport = join(temporary, 'reexport');
  const { RER_LOCAL_OPERATION, RER_STATE_DIR, ...inherited } = fixtureProcessEnv();
  const env = { ...inherited, LAMP_WORKERS_STATE_PATH: source, WRANGLER_SEND_METRICS: 'false' };
  const command = async (binary, args) => {
    try { return await execute(binary, args, { cwd: installation, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 }); }
    catch (error) { throw new Error(`Owner archive command ${args[1] ?? binary} failed: ${String(error.stderr ?? error.code)}`); }
  };
  const script = (name, ...args) => command('pnpm', ['run', name, ...args]);
  const query = async (state, sql) => {
    const result = await command('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--config', 'wrangler.jsonc', '--persist-to', state, '--json', '--command', sql]);
    return JSON.parse(result.stdout).map(item => item.results);
  };
  try {
    await checkout(process.cwd(), installation);
    await mkdir(join(installation, 'migrations/ext'), { recursive: true });
    await writeFile(join(installation, 'migrations/ext/0001_owner.sql'), await readFile('tests/e2e/fixtures/owner-portability.sql'));
    await script('migrate:local');

    const pending = join(installation, 'migrations/ext/0002_owner.sql');
    await writeFile(pending, "UPDATE owner_labels SET label='Uncommitted edit' WHERE id='owner-1'; INSERT INTO missing_owner_table VALUES(1);");
    await assert.rejects(script('migrate:local'), /failed/, 'a failed custom upgrade stops before backup');
    assert.deepEqual((await query(source, "SELECT label FROM owner_labels WHERE id='owner-1'"))[0], [{ label: 'Preserve this owner intent' }], 'its earlier write rolled back');
    await writeFile(pending, "INSERT INTO owner_labels(id,label) VALUES('owner-recovery','Corrected owner migration');");
    await script('migrate:local');
    await script('migrate:local'); // An applied migration does not run again.
    await query(source, "DELETE FROM owner_labels WHERE id='deleted'; DELETE FROM owner_empty;");

    await script('export:cloudflare', '--out', archive, '--persist-to', source);
    await script('import:cloudflare', '--from', archive, '--persist-to', target);
    await assert.rejects(script('import:cloudflare', '--from', archive, '--persist-to', target), /failed/, 'restore never overwrites a populated installation');
    await script('export:cloudflare', '--out', reexport, '--persist-to', target);
    const original = JSON.parse(await readFile(join(archive, 'entities.json'), 'utf8'));
    assert.deepEqual(JSON.parse(await readFile(join(reexport, 'entities.json'), 'utf8')), original, 'all owner tables, relationships, generated values and empty/deleted state survive unchanged');
    assert.deepEqual((await query(target, 'SELECT id,label FROM owner_labels ORDER BY id'))[0], [
      { id: 'owner-1', label: 'Preserve this owner intent' },
      { id: 'owner-recovery', label: 'Corrected owner migration' },
    ]);
    const triggered = await query(target, "INSERT INTO owner_labels(id,label) VALUES('after-restore','Owner customization still works'); SELECT label FROM owner_changes WHERE label='Owner customization still works';");
    assert.deepEqual(triggered[1], [{ label: 'Owner customization still works' }], 'the restored customization retains its behavior');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
