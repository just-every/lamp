import {applyOwnerMigrations} from '../owner-migrations.mjs';
await applyOwnerMigrations(process.argv[2],['--local','--persist-to',process.argv[3]]);
