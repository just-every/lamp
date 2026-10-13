import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntime, executeSql, migrate, loadTypescript } from './runtime.mjs';

const { allocateReference } = await loadTypescript('src/core/shared/references/repository.ts');

test('INCIDENT-003 MAINT-001 allocator reserves durable independent sequences under contention and restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-references-'));
  let runtime = openRuntime(directory);
  try {
    let db = await runtime.getD1Database('DB');
    await migrate(db, name => name < '0013');
    await executeSql(db, await readFile('tests/reference-storage/prior-data.sql', 'utf8'));
    const insertIncident = (id, reference) => db.prepare(`INSERT INTO incidents
      (id,reference,title,lifecycle,opened_at,created_by_operator_id,created_at,updated_at)
      VALUES (?,?,'Test incident','Investigating','2026-01-01','op','2026-01-01','2026-01-01')`).bind(id, reference).run();
    await insertIncident('old-short', 'INC-2');
    await executeSql(db, await readFile('migrations/core/0013_reference_allocations.sql', 'utf8'));
    assert.equal(await db.prepare("SELECT reference FROM incidents WHERE id = 'old'").first('reference'), 'INC-1750000000000123456');
    assert.equal(await db.prepare("SELECT reference FROM maintenance WHERE id = 'scheduled'").first('reference'), 'SCH-1750000000000123456');
    await db.prepare("DELETE FROM incidents WHERE id = 'old-short'").run();
    assert.equal(await allocateReference(db, 'INC'), 'INC-1');
    assert.equal(await allocateReference(db, 'INC'), 'INC-3', 'retired legacy INC-2 is not reused');
    assert.equal(await allocateReference(db, 'SCH'), 'SCH-1', 'separate namespace does not inherit timestamp maximum');
    const references = await Promise.all(Array.from({length: 48}, () => allocateReference(db, 'INC')));
    assert.equal(new Set(references).size, 48);
    assert.deepEqual(references.map(reference => Number(reference.slice(4))).sort((a,b) => a-b), Array.from({length:48}, (_,i) => i + 4));
    await insertIncident('allocated', 'INC-51');
    await db.prepare("DELETE FROM incidents WHERE id = 'allocated'").run();
    // Legacy writers are captured by a trigger, including references deleted
    // before the sequential allocator reaches them.
    await insertIncident('rolling-upgrade', 'INC-53');
    await db.prepare("DELETE FROM incidents WHERE id = 'rolling-upgrade'").run();
    await runtime.dispose(); runtime = openRuntime(directory);
    db = await runtime.getD1Database('DB');
    assert.equal(await allocateReference(db, 'INC'), 'INC-52');
    assert.equal(await allocateReference(db, 'INC'), 'INC-54');
    assert.equal(await allocateReference(db, 'SCH'), 'SCH-2');
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);

    // A real SQL failure on reservation must roll counter advancement back.
    await executeSql(db, `CREATE TRIGGER test_reservation_failure BEFORE INSERT ON reference_allocations
      WHEN NEW.reference = 'INC-55' BEGIN SELECT RAISE(ABORT, 'reservation unavailable'); END;`);
    await assert.rejects(allocateReference(db, 'INC'), /reservation unavailable/);
    assert.equal(await db.prepare("SELECT last_number FROM reference_counters WHERE namespace = 'INC'").first('last_number'), 54);
    await db.prepare('DROP TRIGGER test_reservation_failure').run();
    assert.equal(await allocateReference(db, 'INC'), 'INC-55');
    for (let number = 56; number <= 128; number++) await insertIncident(`imported-${number}`, `INC-${number}`);
    assert.equal(await allocateReference(db, 'INC'), 'INC-129', 'skips an occupied contiguous range without retries');
    await assert.rejects(allocateReference(db, 'invalid'), /Unknown reference namespace/);
    await db.prepare("UPDATE reference_counters SET last_number = 9007199254740991 WHERE namespace = 'SCH'").run();
    await assert.rejects(allocateReference(db, 'SCH'), /Could not allocate SCH reference/);
    assert.equal(await db.prepare("SELECT count(*) AS count FROM reference_allocations WHERE namespace = 'SCH'").first('count'), 3);
  } finally { await runtime.dispose(); await rm(directory, {recursive: true, force: true}); }
});
