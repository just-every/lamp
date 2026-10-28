import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runtime } from './pre-ledger-runtime.mjs';
import { applySql, countStatements } from './apply-sql.mjs';

test('prior-data SQL runner executes data changes and compound triggers without skipping statements', async () => {
  const r = await runtime();
  try {
    const db = await r.db;
    const result = await applySql(db, `
      -- A CREATE-only parser would silently skip the data changes.
      CREATE TABLE migration_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO migration_probe VALUES(1, 'old; value');
      /* Semicolons in comments do not split statements; neither do quotes. */
      CREATE TRIGGER migration_probe_insert AFTER INSERT ON migration_probe
        WHEN NEW.id=2 BEGIN
          UPDATE migration_probe SET value='trigger; value' WHERE id=1;
          INSERT INTO migration_probe VALUES(3, 'temporary');
        END;
      INSERT INTO migration_probe VALUES(2, 'new');
      UPDATE migration_probe SET value=value || '; updated' WHERE id=1;
      DELETE FROM migration_probe WHERE id=3;
    `);
    assert.deepEqual(result, { appliedStatements: 6, statementCount: 6 });
    assert.deepEqual((await db.prepare('SELECT * FROM migration_probe ORDER BY id').all()).results,
      [{ id: 1, value: 'trigger; value; updated' }, { id: 2, value: 'new' }]);
    await assert.rejects(applySql(db, 'UPDATE migration_probe SET value=\'changed\' WHERE id=2; NOT_VALID_SQL;'),
      /syntax error/);
  } finally { await r.close(); }
});

test('the statement count is independent of the splitter and covers every statement form', async () => {
  assert.equal(countStatements(await readFile(new URL('../accounts/schema/invitation-cancellation.sql', import.meta.url), 'utf8')), 3);
  assert.equal(countStatements('-- only a comment; with a semicolon\n/* and; another */'), 0);
  assert.equal(countStatements("INSERT INTO t VALUES('a;b', \"c;d\"); UPDATE t SET v=1"), 2);
  assert.equal(countStatements(`CREATE TRIGGER t_case AFTER INSERT ON t BEGIN
    UPDATE t SET v=CASE WHEN NEW.v>0 THEN 'end;' ELSE CASE WHEN 1 THEN 2 END END; DELETE FROM t WHERE 0;
  END; DROP TRIGGER t_case; SELECT CASE WHEN 1 THEN 2 END;`), 3);
});

test('a splitter that drops a data-changing statement fails before any statement runs', async () => {
  const r = await runtime();
  try {
    const db = await r.db;
    const sql = "CREATE TABLE dropped_probe(id INTEGER PRIMARY KEY);\nINSERT INTO dropped_probe VALUES(1);";
    // The former CREATE-only parser: it silently skips the INSERT.
    const createOnly = text => text.match(/CREATE TABLE[\s\S]*?;/g);
    await assert.rejects(applySql(db, sql, { split: createOnly }), /The splitter found every statement/);
    assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='dropped_probe'").first(), null);
    assert.deepEqual(await applySql(db, sql), { appliedStatements: 2, statementCount: 2 });
    assert.equal((await db.prepare('SELECT count(*) AS n FROM dropped_probe').first()).n, 1);
  } finally { await r.close(); }
});
