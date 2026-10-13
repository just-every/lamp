import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { applyOwnerMigrations as apply, ownerMigrationFiles as files } from './deployment/owner-migrations.mjs';

export const ownerMigrationFiles = () => files('migrations/ext');

// The shared owner-migration runner reads a generated single-database TOML. A
// local wrangler.jsonc is reduced to that database for the run.
async function tomlFor(configPath) {
  if (!/\.jsonc?$/.test(configPath)) return { path: configPath, remove: async () => {} };
  const config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  const database = config.d1_databases.find(entry => entry.binding === 'DB');
  const base = dirname(resolve(configPath));
  const path = join(base, `.lamp-owner-migrations-${randomUUID()}.toml`);
  await writeFile(path, [
    `name = ${JSON.stringify(config.name)}`,
    `compatibility_date = ${JSON.stringify(config.compatibility_date)}`,
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = ${JSON.stringify(database.database_name)}`,
    `database_id = ${JSON.stringify(database.database_id)}`,
    `migrations_dir = ${JSON.stringify(resolve(base, database.migrations_dir))}`,
  ].join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  return { path, remove: () => rm(path, { force: true }) };
}

export async function applyOwnerMigrations(configPath, databaseFlags) {
  const config = await tomlFor(configPath);
  try {
    await apply({ configPath: config.path, databaseFlags, directory: 'migrations/ext', binding: 'DB', ledger: 'lamp_ext_migrations' });
  } finally { await config.remove(); }
}
