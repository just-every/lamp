import { readFileSync, readdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificationPlan } from './plan.mjs';
import { registrations, testInventory } from './inventory.mjs';
import { parseContract } from '../../src/base/seed-contract.mjs';

export function checkVerificationPlan() {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  const steps = Object.values(verificationPlan).flat();
  if (new Set(steps).size !== steps.length) throw Error('A verification command is scheduled more than once.');
  function filesFor(script, seen = new Set()) {
    if (seen.has(script)) throw Error(`Recursive verification script: ${script}`);
    const command = scripts[script];
    if (!command) throw Error(`Missing verification script: ${script}`);
    if (script === 'test:baseline') return [...readdirSync('tests/baseline/e2e-baseline').filter(name => name.endsWith('.test.mjs')).map(name => `tests/baseline/e2e-baseline/${name}`), 'tests/e2e/accessibility.test.mjs'];
    if (script === 'verify:visual:heading') return []; // A distinct mode of the already-covered compiled-edit case.
    const files = [...command.matchAll(/\b(tests\/[\w./*-]+\.mjs)\b/g)].flatMap(match => {
      const path = match[1];
      if (!path.includes('*')) return [path];
      const pattern = new RegExp(`^${basename(path).split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      return readdirSync(dirname(path)).filter(name => pattern.test(name)).map(name => `${dirname(path)}/${name}`);
    });
    for (const match of command.matchAll(/\bpnpm\s+run\s+([\w:-]+)/g)) files.push(...filesFor(match[1], new Set([...seen, script])));
    return files;
  }
  const files = steps.flatMap(step => filesFor(step));
  if (new Set(files).size !== files.length) throw Error('A test file is scheduled more than once in the routine plan.');
  const inventory = testInventory();
  const count = inventory.reduce((sum, entry) => sum + entry.count, 0);
  if (count > 200) throw Error(`Test budget exceeded: ${count}/200 registered cases, including nested and parameterized cases.`);
  const missing = inventory.filter(entry => entry.path.endsWith('.test.mjs') && entry.path !== 'tests/release/upgrade.test.mjs' && !files.includes(entry.path));
  if (missing.length) throw Error(`Tests absent from the routine plan: ${missing.map(entry => entry.path).join(', ')}`);
  const clauses = parseContract(readFileSync('CONTRACT.md', 'utf8')).clauses.filter(clause => clause.kind === 'published').map(clause => clause.id);
  const covered = new Set(files.flatMap(path => registrations(path).flatMap(registration => registration.ids)));
  const uncovered = clauses.filter(id => !covered.has(id));
  if (uncovered.length) throw Error(`Contract clauses without a planned tagged behavior journey: ${uncovered.join(', ')}`);
  console.log(`Verification plan: ${Object.keys(verificationPlan).length} shards, ${files.length} routine test files, ${count}/200 registered cases (including release qualification).`);
  return { count, inventory, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) checkVerificationPlan();
