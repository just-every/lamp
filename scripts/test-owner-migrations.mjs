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
  const addedCore = ['0053_subscriber_intake.sql', '0054_subscriber_webhook_formats.sql', '0055_maintenance_automation_defaults.sql', '0056_subscriber_channels_preferences.sql','0057_component_deliveries.sql','0058_maintenance_wording.sql'];
  for (const name of addedCore) await rm(join(temporary, 'migrations/core', name));
  run('node', ['scripts/migrate-local.mjs']);
  query("INSERT INTO subscribers(id,channel,destination,contact_email,state,selection_mode,token_hash,created_at,updated_at) VALUES('synthetic-lamp-1','webhook','https://receiver.example.test/synthetic-lamp-1','synthetic-lamp-1@example.test','active','all','synthetic-lamp-1','2026-10-23','2026-10-23')");
  for (const name of addedCore.slice(0,3)) await cp(join(root, 'migrations/core', name), join(temporary, 'migrations/core', name));
  run('node', ['scripts/migrate-local.mjs']);
  assert.deepEqual(query("SELECT id,state,destination,created_by_operator_id,webhook_format FROM subscribers WHERE id='synthetic-lamp-1'"), [{id:'synthetic-lamp-1',state:'active',destination:'https://receiver.example.test/synthetic-lamp-1',created_by_operator_id:null,webhook_format:'lamp'}]);
  assert.equal(query('SELECT COUNT(*) n FROM subscriber_intake')[0].n, 0);
  assert.equal(query('SELECT COUNT(*) n FROM maintenance_automation_defaults')[0].n, 0);
  query("INSERT INTO operators(id,email,display_name,is_setup_operator,created_at,updated_at) VALUES('synthetic-lamp-owner','synthetic-lamp-owner@example.test','Synthetic owner',1,'2026-10-23','2026-10-23'); INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,created_at,updated_at) VALUES('synthetic-lamp-token','synthetic-lamp-1','manage','synthetic-lamp-token','2026-10-23','2026-10-23'); INSERT INTO subscriber_intake(subscriber_id,source,operator_id,created_at) VALUES('synthetic-lamp-1','operator','synthetic-lamp-owner','2026-10-23'); INSERT INTO channel_destinations(id,kind,name,sealed_url,host,selection_mode,created_by_operator_id,created_at,updated_at) VALUES('synthetic-lamp-channel','slack','Synthetic','synthetic-sealed','hooks.slack.com','all','synthetic-lamp-owner','2026-10-23','2026-10-23')");
  query("INSERT INTO maintenance(id,reference,title,state,starts_at,ends_at,created_by_operator_id,created_at,updated_at) VALUES('synthetic-lamp-maintenance','SCH-100','Upgrade fixture','Scheduled','2026-10-24','2026-10-25','synthetic-lamp-owner','2026-10-23','2026-10-23'); INSERT INTO notification_deliveries(id,subscriber_id,maintenance_id,channel,outcome,queued_at,created_at,updated_at) VALUES('synthetic-lamp-delivery','synthetic-lamp-1','synthetic-lamp-maintenance','webhook','delivered','2026-10-23','2026-10-23','2026-10-23'); INSERT INTO notification_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,created_at) VALUES('synthetic-lamp-attempt','synthetic-lamp-delivery',1,'2026-10-23','synthetic-lamp-provider-message','2026-10-23'); INSERT INTO mail_provider_webhook_events(id,provider_event_id,provider_message_id,event_type,received_at,created_at,delivery_id) VALUES('synthetic-lamp-provider-event','synthetic-lamp-provider-event','synthetic-lamp-provider-message','delivered','2026-10-23','2026-10-23','synthetic-lamp-delivery')");
  query("INSERT INTO maintenance_notices(id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at) VALUES('synthetic-lamp-legacy-notice','synthetic-lamp-maintenance','scheduled','SCH-100: Upgrade fixture','2026-10-23','synthetic-lamp-owner','2026-10-23','2026-10-23')");
  // Populate the 0055 relationships that a table rebuild used to endanger:
  // component scope, consent capabilities, owner chat history and frozen outcomes.
  query(`INSERT INTO components(id,name,display_order,created_at,updated_at) VALUES('synthetic-lamp-upgrade-component','Upgrade API',1,'2026-10-23','2026-10-23');
    INSERT INTO subscriber_components(id,subscriber_id,component_id,created_at,updated_at) VALUES('synthetic-lamp-upgrade-selection','synthetic-lamp-1','synthetic-lamp-upgrade-component','2026-10-23','2026-10-23');
    INSERT INTO channel_destination_components(destination_id,component_id) VALUES('synthetic-lamp-channel','synthetic-lamp-upgrade-component');
    INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,expires_at,revoked_at,created_at,updated_at) VALUES('synthetic-lamp-upgrade-confirm','synthetic-lamp-1','confirm','synthetic-lamp-upgrade-confirm','2026-10-26','2026-10-23T01:00:00Z','2026-10-23','2026-10-23T01:00:00Z');
    INSERT INTO subscriber_tokens(id,subscriber_id,scope,token_hash,created_at,updated_at) VALUES('synthetic-lamp-upgrade-unsubscribe','synthetic-lamp-1','unsubscribe','synthetic-lamp-upgrade-unsubscribe','2026-10-23','2026-10-23');
    UPDATE subscriber_intake SET confirmed_at='2026-10-23T01:00:00Z' WHERE subscriber_id='synthetic-lamp-1';
    INSERT INTO subscribers(id,channel,destination,state,selection_mode,token_hash,created_at,updated_at) VALUES('synthetic-lamp-upgrade-email','email','synthetic-lamp-upgrade-email@example.test','active','all','synthetic-lamp-upgrade-email','2026-10-23','2026-10-23');
    INSERT INTO incidents(id,reference,title,lifecycle,opened_at,created_by_operator_id,peak_impact,created_at,updated_at) VALUES('synthetic-lamp-upgrade-incident','INC-100','Upgrade incident','Investigating','2026-10-23','synthetic-lamp-owner','Major outage','2026-10-23','2026-10-23');
    INSERT INTO incident_updates(id,incident_id,lifecycle,affected_audience,customer_impact,what_still_works,details,published_at,author_operator_id,created_at,updated_at) VALUES('synthetic-lamp-upgrade-update','synthetic-lamp-upgrade-incident','Investigating','API customers','Requests fail','Dashboard works','Retained update','2026-10-23','synthetic-lamp-owner','2026-10-23','2026-10-23');
    INSERT INTO channel_posts(id,incident_update_id,destination_id,queued_at) VALUES('synthetic-lamp-upgrade-post','synthetic-lamp-upgrade-update','synthetic-lamp-channel','2026-10-23');
    UPDATE notification_deliveries SET notification_event_id='synthetic-lamp-maintenance',notification_event_type='maintenance-notice',mail_payload_json='{"subject":"Retained subject","text":"Retained original wording"}',outcome_at='2026-10-23T01:00:00Z' WHERE id='synthetic-lamp-delivery';`);
  const priorCoreLedger = query('SELECT name FROM d1_migrations ORDER BY id');
  assert.equal(priorCoreLedger.length,55,'the populated source is exactly the main-applied 0055 schema');
  const preservedUpgrade = Object.fromEntries(['subscribers','subscriber_components','subscriber_tokens','subscriber_intake','channel_destinations','channel_destination_components','channel_posts','notification_deliveries','notification_delivery_attempts','mail_provider_webhook_events','subscriber_reporting_baseline','subscriber_reporting_daily','maintenance','maintenance_notices','incidents','incident_updates'].map(table=>[table,query(`SELECT * FROM ${table}`)]));
  for(const name of addedCore.slice(3))await cp(join(root, 'migrations/core',name),join(temporary,'migrations/core',name));
  run('node', ['scripts/migrate-local.mjs']);
  assert.deepEqual(query('PRAGMA foreign_key_check'),[]);
  for(const [table,rows] of Object.entries(preservedUpgrade)) {
    const columns=Object.keys(rows[0] ?? {}).map(name=>`"${name}"`).join(',');
    if(columns)assert.deepEqual(query(`SELECT ${columns} FROM ${table}`),rows,`upgrade preserves ${table}`);
  }

  assert.deepEqual(query("SELECT affected_audience,customer_impact FROM maintenance WHERE id='synthetic-lamp-maintenance'"),[{affected_audience:null,customer_impact:null}],"pre-release maintenance stays title-only without backfill");
  assert.equal(query("SELECT body FROM maintenance_notices WHERE id='synthetic-lamp-legacy-notice'")[0].body,'SCH-100: Upgrade fixture',"the upgrade never rewrites an immutable legacy title-only notice");
  assert.equal(query("SELECT count(*) AS n FROM subscriber_tokens WHERE id='synthetic-lamp-token'")[0].n,1);
  assert.equal(query("SELECT count(*) AS n FROM subscriber_intake WHERE subscriber_id='synthetic-lamp-1'")[0].n,1);
  assert.equal(query("SELECT count(*) AS n FROM channel_destinations WHERE id='synthetic-lamp-channel'")[0].n,1);
  assert.deepEqual(JSON.parse(query("SELECT event_kinds_json FROM subscribers WHERE id='synthetic-lamp-1'")[0].event_kinds_json),['incidents','maintenance','components']);

  for (const [table, view] of [['subscribers','subscriber_directory'],['channel_destinations','delivery_channel_destinations'],['channel_posts','delivery_channel_posts'],['notification_deliveries','notification_delivery_records'],['notification_delivery_attempts','notification_attempt_records']]) {
    const rows=preservedUpgrade[table],columns=Object.keys(rows[0]).map(name=>`"${name}"`).join(',');
    assert.deepEqual(query(`SELECT ${columns} FROM ${view}`),rows,`the current product reads every retained 0055 ${table} row exactly once`);
  }
  assert.deepEqual(query("SELECT channel,event_kinds_json,minimum_impact FROM subscriber_directory WHERE id='synthetic-lamp-upgrade-email'"),[{channel:'email',event_kinds_json:'["incidents","maintenance"]',minimum_impact:null}], 'an older email subscriber does not silently opt into component notifications');
  assert.deepEqual(query('SELECT name FROM d1_migrations ORDER BY id').slice(0,55),priorCoreLedger,'all main-applied migration identities stay in their original order');

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
  console.log(JSON.stringify({ product, passed: true, coreMigrations: coreLedger.length, ledger, scenarios: ['actual local command', 'populated 0055 upgrade retains subscription authority and delivery history', 'ordered owner SQL', 'rerun preserves ledger and data', 'failure rolls back migration', 'temporary configuration cleanup', 'correct unapplied failure and rerun'] }, null, 2));
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString());
  if (error.stderr) console.error(error.stderr.toString());
  throw error;
} finally { await rm(temporary, { recursive: true, force: true }); }
