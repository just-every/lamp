import { applyOwnerMigrations as apply, ownerMigrationFiles as files } from './deployment/owner-migrations.mjs';

export const ownerMigrationFiles = () => files('migrations/ext');
export const applyOwnerMigrations = (configPath, databaseFlags) => apply({
  configPath, databaseFlags, directory: 'migrations/ext', binding: 'DB', ledger: 'lamp_ext_migrations',
});
