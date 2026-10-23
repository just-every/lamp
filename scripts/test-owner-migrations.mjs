import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const product = 'lamp';
const ledger = `${product}_ext_migrations`;
const temporary = await mkdtemp(join(tmpdir(), `${product}-owner-migrations-`));
const state = join(temporary, 'state');
const env = { ...process.env, CI: 'true', LILY_PERSIST_PATH: state, LAMP_WORKERS_STATE_PATH: state };
function run(command, args) { return execFileSync(command, args, { cwd: temporary, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
const config = product === 'lily' ? 'deploy/wrangler.toml' : 'wrangler.jsonc';
function query(sql) {
  const output = run('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', state, '--config', config, '--command', sql, '--json']);
  return JSON.parse(output)[0].results;
}
try {
  for (const entry of ['scripts', 'wrangler.jsonc', 'migrations', 'src', 'seed.json', 'package.json']) await cp(join(root, entry), join(temporary, entry), { recursive: true });
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  await mkdir(join(temporary, 'migrations/ext'), { recursive: true });
  // Create files in reverse order; the second depends on the first and core schema.
  await writeFile(join(temporary, 'migrations/ext/0002_owner.sql'), "INSERT INTO owner_notes VALUES (2, 'second');");
  await writeFile(join(temporary, 'migrations/ext/0001_owner.sql'), "CREATE TABLE owner_notes (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO owner_notes SELECT 1, 'preserved' WHERE EXISTS (SELECT 1 FROM d1_migrations);");
  const addedCore = ['0053_subscriber_intake.sql', '0054_subscriber_webhook_formats.sql', '0055_maintenance_automation_defaults.sql'];
  for (const name of addedCore) await rm(join(temporary, 'migrations/core', name));
  run('node', ['scripts/migrate-local.mjs']);
  query("INSERT INTO subscribers(id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES('synthetic-lamp-1','webhook','https://receiver.example.test/synthetic-lamp-1','synthetic-lamp-1@example.test','active','all','synthetic-lamp-1','2026-10-23','2026-10-23')");
  for (const name of addedCore) await cp(join(root, 'migrations/core', name), join(temporary, 'migrations/core', name));
  run('node', ['scripts/migrate-local.mjs']);
  assert.deepEqual(query("SELECT id,state,destination,created_by_operator_id,webhook_format FROM subscribers WHERE id='synthetic-lamp-1'"), [{id:'synthetic-lamp-1',state:'active',destination:'https://receiver.example.test/synthetic-lamp-1',created_by_operator_id:null,webhook_format:'lamp'}]);
  assert.equal(query('SELECT COUNT(*) n FROM subscriber_intake')[0].n, 0);
  assert.equal(query('SELECT COUNT(*) n FROM maintenance_automation_defaults')[0].n, 0);
  assert.deepEqual(query('SELECT * FROM owner_notes ORDER BY id'), [{ id: 1, value: 'preserved' }, { id: 2, value: 'second' }]);
  const originalLedger = query(`SELECT * FROM ${ledger} ORDER BY id`);
  const coreLedger = query('SELECT * FROM d1_migrations ORDER BY id');
  run('node', ['scripts/migrate-local.mjs']);
  assert.deepEqual(query(`SELECT * FROM ${ledger} ORDER BY id`), originalLedger);
  assert.deepEqual(query('SELECT * FROM d1_migrations ORDER BY id'), coreLedger);
  await writeFile(join(temporary, 'migrations/ext/0003_owner.sql'), "INSERT INTO owner_notes VALUES (3, 'rolled back'); INSERT INTO missing_owner_table VALUES (1);");
  assert.throws(() => run('node', ['scripts/migrate-local.mjs']));
  assert.equal(query('SELECT * FROM owner_notes').length, 2);
  assert.deepEqual(query(`SELECT * FROM ${ledger} ORDER BY id`), originalLedger);
  assert.equal((await readdir(temporary)).some(name => name.startsWith('.lamp-owner-migrations-') || name.startsWith('.owner-migrations-')), false);
  // An unapplied failed migration can be corrected; applied files stay unchanged.
  await writeFile(join(temporary, 'migrations/ext/0003_owner.sql'), "INSERT INTO owner_notes VALUES (3, 'recovered');");
  run('node', ['scripts/migrate-local.mjs']);
  assert.equal(query('SELECT value FROM owner_notes WHERE id = 1')[0].value, 'preserved');
  assert.equal(query(`SELECT * FROM ${ledger}`).length, 3);
  assert.deepEqual(query('SELECT * FROM d1_migrations ORDER BY id'), coreLedger);
  console.log(JSON.stringify({ product, passed: true, coreMigrations: coreLedger.length, ledger, scenarios: ['actual local command', 'ordered owner SQL', 'rerun preserves ledger and data', 'failure rolls back migration', 'temporary configuration cleanup', 'correct unapplied failure and rerun'] }, null, 2));
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString());
  if (error.stderr) console.error(error.stderr.toString());
  throw error;
} finally { await rm(temporary, { recursive: true, force: true }); }
