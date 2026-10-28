import { readFileSync, writeFileSync } from 'node:fs';
import { parseContract } from '../src/base/seed-contract.mjs';

const [mode, ...ids] = process.argv.slice(2);
if (!['write', 'check'].includes(mode) || !ids.length) throw Error('Usage: node scripts/contract-docs.mjs write|check CLAUSE...');
const source = readFileSync('CONTRACT.md', 'utf8');
const contract = parseContract(source);
const cells = line => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim());
const row = values => '| ' + values.join(' | ') + ' |';
const clauses = ids.map(id => {
  const clause = contract.clauses.find(item => item.id === id);
  if (!clause) throw Error(`Unknown clause ${id}`);
  const values = cells(source.split('\n')[clause.row - 1]);
  return { ...clause, proof: values[4], gap: values[5] };
});
const changes = new Map();
let acceptance = readFileSync('ACCEPTANCE.md', 'utf8');
let claims = readFileSync('docs/CLAIMS.md', 'utf8');
for (const clause of clauses) {
  let found = false;
  acceptance = acceptance.split('\n').map(line => {
    if (!line.startsWith('| ')) return line;
    const values = cells(line);
    if (values[0]?.replaceAll('`', '') !== clause.id) return line;
    if (values.length !== 5) throw Error(`Unknown acceptance table shape for ${clause.id}`);
    found = true;
    values[2] = clause.status;
    values[4] = clause.proof + (clause.gap ? ` Gap: ${clause.gap}` : '');
    return row(values);
  }).join('\n');
  if (!found) throw Error(`Missing acceptance row for ${clause.id}`);
  const replacement = row([clause.id, clause.status, clause.proof, clause.gap]);
  const lines = claims.split('\n');
  const index = lines.findIndex(line => line.startsWith('| ') && cells(line)[0]?.replaceAll('`', '') === clause.id);
  if (index >= 0) lines[index] = replacement;
  else {
    const end = lines.findLastIndex(line => line.startsWith('| '));
    lines.splice(end + 1, 0, replacement);
  }
  claims = lines.join('\n');
}
changes.set('ACCEPTANCE.md', acceptance);
changes.set('docs/CLAIMS.md', claims);
const lines = source.split('\n');
for (const [label, selected] of [['Published', contract.clauses.filter(item => item.kind === 'published')], ['Target and push further', contract.clauses.filter(item => item.kind !== 'published')], ['All', contract.clauses]]) {
  const index = lines.findIndex(line => line.startsWith(`| ${label} |`));
  if (index < 0) throw Error(`Missing ${label} summary row`);
  lines[index] = row([label, ...['done', 'partial', 'missing'].map(status => selected.filter(item => item.status === status).length), selected.length]);
}
changes.set('CONTRACT.md', lines.join('\n'));
for (const [path, result] of changes) {
  if (mode === 'write') writeFileSync(path, result);
  else if (readFileSync(path, 'utf8') !== result) throw Error(`Stale generated clause view: ${path}`);
}
console.log(`Contract views ${mode}: ${ids.join(', ')}`);
