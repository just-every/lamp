import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readArchive } from '@runeditrun/rer/modules/portability';
import { bindCell } from '@runeditrun/rer/modules/portability/catalogue';
import { contract } from '../contract.mjs';
import { checkout, command, proxy } from '../helpers/native-transfer.mjs';
import { installManaged } from './helpers/managed-install.mjs';

// A native backup the listed release (c5dab715, migrations up to 0032) made with
// its own rer of a populated install, retained unchanged: that release's HIST-004
// records, later state changes of its component and one audit entry. Every value is synthetic.
const fixture = new URL('../fixtures/archive/listed-c5dab715.rer', import.meta.url);
const quote = name => `"${name.replaceAll('"', '""')}"`;
const cell = value => { const bound = bindCell(value); return bound instanceof ArrayBuffer ? Buffer.from(bound).toString('base64') : bound; };
const key = (columns, row) => JSON.stringify(columns.map(name => row[name] instanceof ArrayBuffer ? Buffer.from(row[name]).toString('base64') : row[name]));
// 0033 mirrors every state change into the audit log, as it does for a live upgrade.
const mirrored = history => ({ id: `state-history/${history.id}`, entity_type: 'component', entity_id: history.component_id, action: 'state-changed', operator_id: history.operator_id, reason: null,
  payload_json: JSON.stringify({ previousState: history.previous_state, newState: history.new_state, causeType: history.cause_type, causeId: history.cause_id }), created_at: history.created_at, updated_at: history.updated_at });

contract('HIST-004', 'a backup made before migration 0033 restores through rer import into a native and a RER Managed installation with its state history and audit entries', async () => {
  const root = process.cwd(), directory = await mkdtemp(join(root, '.lamp-prior-backup-'));
  const records = []; for await (const record of readArchive(new Blob([await readFile(fixture)]).stream())) records.push(record);
  const [manifest] = records, items = records.filter(record => record.kind === 'part').flatMap(record => record.items);
  const archived = name => items.filter(item => item.kind === 'row' && item.table === name).map(item => Object.fromEntries(Object.entries(item.row).map(([column, value]) => [column, cell(value)])));
  const history = archived('component_state_history');
  assert.ok(history.length > 1, 'the backup holds state history');
  assert.ok(archived('subscribers').length > 0, 'the unchanged older backup holds subscription identity and scope');
  assert.ok(archived('notification_deliveries').length > 0, 'the unchanged older backup holds retained delivery outcomes');
  try {
    // Native: rer applies the migrations under Wrangler's ledger. Managed: Platform's
    // runner already applied them under rer_migrations, and Lamp's page initializer
    // seeded this installation's page settings, which the restore replaces.
    for (const destination of ['native', 'managed']) {
      const target = join(directory, destination);
      await checkout(root, target);
      if (destination === 'managed') await installManaged(join(target, '.wrangler/state'), { config: 'wrangler.jsonc', pageName: 'Managed destination' });
      const ledger = async () => { const platform = await proxy(target); try { return (await platform.env.DB.prepare('SELECT name, sha256, applied_at FROM rer_migrations ORDER BY rowid').all()).results; } finally { await platform.dispose(); } };
      const platformLedger = destination === 'managed' && await ledger();
      // rer import reads only an owner-private input, whatever mode the checkout gave the fixture.
      await mkdir(join(target, 'exports')); await copyFile(fixture, join(target, 'exports/prior.rer')); await chmod(join(target, 'exports/prior.rer'), 0o600);
      await command(target, 'import', '--input', 'exports/prior.rer', '--yes');
      if (platformLedger) assert.deepEqual(await ledger(), platformLedger, 'the restore leaves Platform\'s ledger as it was');

      const current = await proxy(target);
      try {
        const db = current.env.DB;
        for (const table of manifest.tables) {
          const columns = table.columns.map(column => column.name);
          const expected = [...archived(table.name), ...(table.name === 'audit_entries' ? history.map(mirrored) : [])].map(row => key(columns, row)).sort();
          const actual = (await db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table.name)}`).all()).results.map(row => key(columns, row)).sort();
          assert.deepEqual(actual, expected, `${destination}: every archived value: ${table.name}`);
        }
        // The current product's logical reads expose the archived history once,
        // after the supported bridge has restored the original physical rows.
        for (const [table, view] of [['subscribers','subscriber_directory'],['notification_deliveries','notification_delivery_records']]) {
          const columns=manifest.tables.find(item=>item.name===table).columns.map(column=>column.name);
          const actual=(await db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(view)}`).all()).results.map(row=>key(columns,row)).sort();
          assert.deepEqual(actual,archived(table).map(row=>key(columns,row)).sort(),`${destination}: current product reads every archived ${table} value exactly once`);
        }
        const preferences=(await db.prepare('SELECT id,event_kinds_json,minimum_impact FROM subscriber_directory ORDER BY id').all()).results;
        assert.deepEqual(preferences,archived('subscribers').map(row=>({id:row.id,event_kinds_json:JSON.stringify(row.channel==='webhook'?['incidents','maintenance','components']:['incidents','maintenance']),minimum_impact:null})).sort((a,b)=>a.id.localeCompare(b.id)),`${destination}: older subscriptions retain the channel defaults without invented consent`);
        // The restored installation keeps auditing state changes.
        const [last] = history;
        await db.prepare('INSERT INTO component_state_history (id, component_id, previous_state, new_state, cause_type, cause_id, operator_id, supersedes_history_id, changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)')
          .bind('after-restore', last.component_id, last.new_state, last.previous_state, last.cause_type, last.cause_id, last.operator_id, last.changed_at, last.created_at, last.updated_at).run();
        assert.equal((await db.prepare("SELECT action FROM audit_entries WHERE id = 'state-history/after-restore'").first())?.action, 'state-changed', destination);
        assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [], destination);
        for (const object of manifest.objects) {
          const stored = await current.env.SNAPSHOTS.get(object.key); assert.ok(stored, `${destination}: ${object.key}`);
          const chunks = items.filter(item => item.kind === 'object' && item.key === object.key).sort((a, b) => a.offset - b.offset);
          assert.deepEqual(Buffer.from(await stored.arrayBuffer()), Buffer.concat(chunks.map(item => Buffer.from(item.data, 'base64'))), `${destination}: ${object.key}`);
        }
      } finally { await current.dispose(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
