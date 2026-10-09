import { execFileSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function ownerMigrationFiles(directory) {
  try { return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.sql')).map(entry => entry.name).sort(); }
  catch (cause) { if (cause.code === 'ENOENT') return []; throw cause; }
}

/** Edition policy supplies the directory, binding and permanent migration ledger. */
export async function applyOwnerMigrations({ configPath, directory, binding, ledger, databaseFlags }) {
  if (!(await ownerMigrationFiles(directory)).length) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ledger) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding)) throw new Error('Owner migrations require a binding and SQL ledger identifier.');
  const source = await readFile(configPath, 'utf8');
  // Deliberately limited to the generated single-D1 TOML used by adopters.
  const sections = source.split(/(?=^\[)/m);
  const databases = sections.filter(section => /^\[\[d1_databases\]\]/.test(section));
  if (!configPath.endsWith('.toml') || databases.length !== 1
      || !new RegExp(`^binding\\s*=\\s*["']${binding}["']\\s*$`, 'm').test(databases[0])
      || (databases[0].match(/^migrations_dir\s*=/gm) ?? []).length !== 1) {
    throw new Error('Owner migrations require generated single-database TOML with the selected binding and migrations_dir.');
  }
  const database = databases[0].replace(/^migrations_table\s*=.*\n?/gm, '')
    .replace(/^migrations_dir\s*=.*$/m, `migrations_dir = ${JSON.stringify(resolve(directory))}\nmigrations_table = ${JSON.stringify(ledger)}`);
  const temporary = join(dirname(resolve(configPath)), `.owner-migrations-${randomUUID()}.toml`);
  try {
    // Keep relative asset/main paths and Wrangler's local persistence root intact.
    await writeFile(temporary, source.replace(databases[0], database), { mode: 0o600, flag: 'wx' });
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', binding, '--config', temporary, ...databaseFlags], { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
  } finally { await rm(temporary, { force: true }); }
}
