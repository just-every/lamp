import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readArchive } from '@runeditrun/rer/modules/portability';
import { bindCell } from '@runeditrun/rer/modules/portability/catalogue';
import { contract } from '../contract.mjs';
import { checkout, command, proxy } from '../helpers/native-transfer.mjs';

// A native backup the listed release (c5dab715, migrations up to 0032) made of a
// populated install, retained unchanged: HIST-004's records, a Better Stack
// move-in, 11 component state changes and one audit entry. Addresses are synthetic.
const fixture = new URL('../fixtures/archive/listed-c5dab715.rer', import.meta.url);
const quote = name => `"${name.replaceAll('"', '""')}"`;
const cell = value => { const bound = bindCell(value); return bound instanceof ArrayBuffer ? Buffer.from(bound).toString('base64') : bound; };
const key = (columns, row) => JSON.stringify(columns.map(name => row[name] instanceof ArrayBuffer ? Buffer.from(row[name]).toString('base64') : row[name]));
// 0033 mirrors every state change into the audit log, as it does for a live upgrade.
const mirrored = history => ({ id: `state-history/${history.id}`, entity_type: 'component', entity_id: history.component_id, action: 'state-changed', operator_id: history.operator_id, reason: null,
  payload_json: JSON.stringify({ previousState: history.previous_state, newState: history.new_state, causeType: history.cause_type, causeId: history.cause_id }), created_at: history.created_at, updated_at: history.updated_at });

contract('HIST-004', 'a backup made before migration 0033 restores through rer import with its state history and audit entries', async () => {
  const root = process.cwd(), directory = await mkdtemp(join(root, '.lamp-prior-backup-')), target = join(directory, 'install');
  let current;
  try {
    await checkout(root, target);
    // rer import reads only an owner-private input, whatever mode the checkout gave the fixture.
    await mkdir(join(target, 'exports')); await copyFile(fixture, join(target, 'exports/prior.rer')); await chmod(join(target, 'exports/prior.rer'), 0o600);
    await command(target, 'import', '--input', 'exports/prior.rer', '--yes');

    const records = []; for await (const record of readArchive(new Blob([await readFile(fixture)]).stream())) records.push(record);
    const [manifest] = records, items = records.filter(record => record.kind === 'part').flatMap(record => record.items);
    const archived = name => items.filter(item => item.kind === 'row' && item.table === name).map(item => Object.fromEntries(Object.entries(item.row).map(([column, value]) => [column, cell(value)])));
    current = await proxy(target);
    const db = current.env.DB;
    const history = archived('component_state_history');
    assert.equal(history.length, 11, 'the backup holds state history');
    for (const table of manifest.tables) {
      const columns = table.columns.map(column => column.name);
      const expected = [...archived(table.name), ...(table.name === 'audit_entries' ? history.map(mirrored) : [])].map(row => key(columns, row)).sort();
      const actual = (await db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table.name)}`).all()).results.map(row => key(columns, row)).sort();
      assert.deepEqual(actual, expected, `every archived value: ${table.name}`);
    }
    // The restored installation keeps auditing state changes.
    const [last] = history;
    await db.prepare('INSERT INTO component_state_history (id, component_id, previous_state, new_state, cause_type, cause_id, operator_id, supersedes_history_id, changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)')
      .bind('after-restore', last.component_id, last.new_state, last.previous_state, last.cause_type, last.cause_id, last.operator_id, last.changed_at, last.created_at, last.updated_at).run();
    assert.equal((await db.prepare("SELECT action FROM audit_entries WHERE id = 'state-history/after-restore'").first())?.action, 'state-changed');
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    for (const object of manifest.objects) {
      const stored = await current.env.SNAPSHOTS.get(object.key); assert.ok(stored, object.key);
      const chunks = items.filter(item => item.kind === 'object' && item.key === object.key).sort((a, b) => a.offset - b.offset);
      assert.deepEqual(Buffer.from(await stored.arrayBuffer()), Buffer.concat(chunks.map(item => Buffer.from(item.data, 'base64'))), object.key);
    }
  } finally { await current?.dispose(); await rm(directory, { recursive: true, force: true }); }
});
