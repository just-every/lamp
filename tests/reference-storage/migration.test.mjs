import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntime, executeSql, migrate, databaseSnapshot } from './runtime.mjs';

const indexesAndTriggers = async db => (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('index','trigger') ORDER BY name").all()).results;
const foreignKeys = async db => {
  const { results } = await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE '_cf_%'").all();
  return Object.fromEntries(await Promise.all(results.map(async ({name}) => [name, (await db.prepare(`PRAGMA foreign_key_list("${name}")`).all()).results])));
};

test('UPDATE-001 prior-data migration preserves every row, relationship, index and trigger in real D1', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-migration-'));
  const runtime = openRuntime(directory);
  try {
    const db = await runtime.getD1Database('DB');
    await migrate(db, name => name < '0012');
    await executeSql(db, await readFile('tests/reference-storage/prior-data.sql', 'utf8'));
    const before = await databaseSnapshot(db);
    const schemaBefore = await indexesAndTriggers(db);
    const keysBefore = await foreignKeys(db);
    const columnsBefore = (await db.prepare('PRAGMA table_info(incident_updates)').all()).results;
    assert.equal(columnsBefore.find(column => column.name === 'next_update_at').notnull, 1);
    const migration = await readFile('migrations/core/0012_resolved_update_time.sql', 'utf8');
    await assert.rejects(executeSql(db, migration + '\nINSERT INTO missing_migration_table VALUES (1);'), /no such table/);
    assert.deepEqual(await databaseSnapshot(db), before, 'failure rolls the column replacement back');
    assert.deepEqual((await db.prepare('PRAGMA table_info(incident_updates)').all()).results, columnsBefore);
    await executeSql(db, migration);
    assert.deepEqual(await databaseSnapshot(db), before, 'includes legacy promises, corrections, drafts, attachments, mail and delivery links');
    assert.deepEqual(await indexesAndTriggers(db), schemaBefore);
    assert.deepEqual(await foreignKeys(db), keysBefore);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1);
    const columnsAfter = (await db.prepare('PRAGMA table_info(incident_updates)').all()).results;
    assert.equal(columnsAfter.find(column => column.name === 'next_update_at').notnull, 0);
    for (const before of columnsBefore.filter(column => column.name !== 'next_update_at')) {
      const { cid: beforeIndex, ...properties } = before;
      const { cid: afterIndex, ...afterProperties } = columnsAfter.find(column => column.name === before.name);
      assert.deepEqual(afterProperties, properties);
    }
    const dirtyBefore = await db.prepare("SELECT requested_revision FROM public_snapshot_work WHERE id = 'default'").first('requested_revision');
    await db.prepare(`INSERT INTO incident_updates
      (id,incident_id,lifecycle,affected_audience,customer_impact,next_update_at,published_at,author_operator_id,created_at,updated_at)
      VALUES ('new-resolution','old','Resolved','Users','Restored',NULL,'2026-01-03','op','2026-01-03','2026-01-03')`).run();
    assert.equal(await db.prepare("SELECT next_update_at FROM incident_updates WHERE id = 'new-resolution'").first('next_update_at'), null);
    assert.equal(await db.prepare("SELECT requested_revision FROM public_snapshot_work WHERE id = 'default'").first('requested_revision'), dirtyBefore + 1);
    await assert.rejects(db.prepare("DELETE FROM incident_updates WHERE id = 'initial'").run(), /FOREIGN KEY/);
    await assert.rejects(db.prepare("UPDATE incident_updates SET incident_id = 'missing' WHERE id = 'new-resolution'").run(), /FOREIGN KEY/);
    await assert.rejects(db.prepare("UPDATE incident_updates SET lifecycle = 'Invalid' WHERE id = 'new-resolution'").run(), /CHECK/);
    await assert.rejects(db.prepare("UPDATE incident_updates SET customer_impact = ? WHERE id = 'new-resolution'").bind('x'.repeat(251)).run(), /CHECK/);
    await db.prepare("DELETE FROM incident_updates WHERE id = 'new-resolution'").run();
    assert.equal(await db.prepare("SELECT requested_revision FROM public_snapshot_work WHERE id = 'default'").first('requested_revision'), dirtyBefore + 2);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await runtime.dispose(); await rm(directory, {recursive: true, force: true}); }
});
