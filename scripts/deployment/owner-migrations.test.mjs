import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyOwnerMigrations, ownerMigrationFiles } from './owner-migrations.mjs';

test('optional directory, regular SQL files and explicit unsupported configuration failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'owner-migrations-'));
  const directory = join(root, 'owner-schema');
  const configPath = join(root, 'wrangler.toml');
  const options = { directory, configPath, binding: 'DB', ledger: 'owner_history', databaseFlags: ['--local'] };
  try {
    assert.deepEqual(await ownerMigrationFiles(directory), []);
    await applyOwnerMigrations(options);
    await mkdir(directory);
    await mkdir(join(directory, '0000.sql'));
    await writeFile(join(directory, '0002.sql'), 'SELECT 2;');
    await writeFile(join(directory, '0001.sql'), 'SELECT 1;');
    await writeFile(join(directory, 'README.md'), 'Owner instructions');
    assert.deepEqual(await ownerMigrationFiles(directory), ['0001.sql', '0002.sql']);
    for (const config of ['', '[[d1_databases]]\nbinding = "OTHER"\nmigrations_dir = "core"\n', '[[d1_databases]]\nbinding = "DB"\nmigrations_dir = "core"\n[[d1_databases]]\nbinding = "OTHER"\n']) {
      await writeFile(configPath, config);
      await assert.rejects(applyOwnerMigrations(options), /single-database TOML/);
    }
    await assert.rejects(applyOwnerMigrations({ ...options, ledger: 'bad;ledger' }), /ledger identifier/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
