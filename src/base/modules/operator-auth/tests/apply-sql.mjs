import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packages = await readdir(join(root, 'node_modules/.pnpm'));
const wrangler = packages.find(name => name.startsWith('wrangler@4.129.1_'));
if (!wrangler) throw new Error('Install the frozen workspace dependencies before running auth workerd tests.');
const require = createRequire(join(root, 'node_modules/.pnpm', wrangler, 'node_modules/wrangler/package.json'));
const { unstable_splitSqlQuery: splitSqlQuery } = require('wrangler');

// Count statements without the splitter: drop comments and quoted text, then
// count top-level semicolons. A trigger body (and CASE ... END inside it) keeps
// its inner semicolons; a trailing statement without a semicolon still counts.
const TOKENS = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_$]*|;|\S/g;
export function countStatements(sql) {
  let count = 0, pending = false, trigger = false, body = false, cases = 0;
  for (const [token] of sql.matchAll(TOKENS)) {
    if (token.startsWith('--') || token.startsWith('/*')) continue;
    if (token === ';') {
      if (!body) { if (pending) count++; pending = false; trigger = false; }
      continue;
    }
    pending = true;
    const word = token.toUpperCase();
    if (!body && word === 'TRIGGER') trigger = true;
    else if (!body && trigger && word === 'BEGIN') body = true;
    else if (body && word === 'CASE') cases++;
    else if (body && word === 'END') { if (cases) cases--; else body = false; }
  }
  return count + (pending ? 1 : 0);
}

// Apply a whole SQL file the way Wrangler applies a migration: every statement,
// whatever its verb. The splitter's result must match the independent count
// before anything runs, and every statement must run.
export async function applySql(db, sql, { split = splitSqlQuery } = {}) {
  const statementCount = countStatements(sql);
  const statements = split(sql);
  assert.equal(statements.length, statementCount, 'The splitter found every statement in the SQL file');
  let appliedStatements = 0;
  for (const statement of statements) {
    const result = await db.prepare(statement).run();
    assert.equal(result.success, true, `SQL statement ${appliedStatements + 1} succeeded`);
    appliedStatements++;
  }
  assert.equal(appliedStatements, statementCount, 'Applied every statement in the SQL file');
  return { appliedStatements, statementCount };
}
