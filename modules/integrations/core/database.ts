export interface SqlStatement { sql: string; params?: (string | number | null)[] }
export interface SqlDatabase {
  /** All statements execute in one transaction; any failure rolls everything back. */
  batch(statements: SqlStatement[]): Promise<Record<string, unknown>[][]>;
}
interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
}
export interface D1Binding {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<{ results: Record<string, unknown>[]; success: boolean }[]>;
}
export class D1SqlDatabase implements SqlDatabase {
  private binding: D1Binding;
  constructor(binding: D1Binding) { this.binding = binding; }
  async batch(statements: SqlStatement[]) {
    const result = await this.binding.batch(statements.map(s => this.binding.prepare(s.sql).bind(...(s.params ?? []))));
    if (result.some(r => !r.success)) throw new Error('Integration database transaction failed');
    return result.map(r => r.results);
  }
}
