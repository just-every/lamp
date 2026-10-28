import { DatabaseSync } from '../../container/adapters/d1-sqlite.mjs';
import { readFileSync } from 'node:fs';

// Test-only D1 API adapter: execute the production SQL and transaction boundaries
// in SQLite without starting workerd. Runtime/D1 conformance remains separate.
export function transactionDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const path of ['../../operator-auth/accounts/schema/operator-auth.sql', '../schema/owner-claim.sql']) {
    sqlite.exec(readFileSync(new URL(path, import.meta.url), 'utf8'));
  }
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  function prepare(sql, args = []) {
    return {
      bind: (...values) => prepare(sql, values),
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      execute() {
        const statement = sqlite.prepare(sql);
        const results = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
        return { results, meta: { changes: sqlite.prepare('SELECT changes() AS count').get().count } };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    snapshot: () => Object.fromEntries(tables.map(table => [table, sqlite.prepare(`SELECT * FROM ${table}`).all()])),
    close: () => sqlite.close(),
  };
}
