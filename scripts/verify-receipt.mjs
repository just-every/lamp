import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { cleanSourceIdentity } from './verification-evidence.mjs';
import { parseArgs } from './ops-config.mjs';

try {
  const flags = parseArgs(process.argv.slice(2));
  const output = flags.get('output');
  if (flags.size !== 1 || !output || !isAbsolute(output) || !relative(process.cwd(), output).startsWith('..')) throw new Error('Use --output with an absolute JSON receipt path outside the source checkout.');
  const source = cleanSourceIdentity();
  const command = ['pnpm', 'run', 'verify'];
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Full verification failed; no success receipt was written.');
  const after = cleanSourceIdentity();
  if (JSON.stringify(source) !== JSON.stringify(after)) throw new Error('Source identity changed during verification; no receipt was written.');
  await writeFile(resolve(output), JSON.stringify({ version: 1, kind: 'lamp-full-verification', ...source, command, exitCode: 0, finishedAt: new Date().toISOString() }) + '\n', { mode: 0o600, flag: 'wx' });
  console.log('Full verification succeeded. Exact-source evidence saved.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
