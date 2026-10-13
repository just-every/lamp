import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlStatement } from './database.ts';
/** Node 22.13+ SQLite. Durable files should be on a local filesystem with reliable locking. */
export class SqliteDatabase implements SqlDatabase {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  }
  migrate(sql: string) { this.db.exec(sql); }
  close() { this.db.close(); }
  async batch(statements: SqlStatement[]): Promise<Record<string, unknown>[][]> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map(s => this.db.prepare(s.sql).all(...(s.params ?? [])) as Record<string, unknown>[]);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
