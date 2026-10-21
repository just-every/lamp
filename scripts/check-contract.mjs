// Keep the named Lamp check on the same parser and evidence rules as rer check.
import { contractStatusClauses } from '@runeditrun/rer/internal/cli/contract-status.mjs';

const checks = await contractStatusClauses(process.cwd());
const failures = checks.filter(check => !check.ok);
if (!checks.length || failures.length) throw new Error(failures.map(check => `${check.id}: ${check.message}`).join('\n') || 'No contract checks ran.');
console.log(`Contract: ${checks.length} checks passed.`);
