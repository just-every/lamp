import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readDeployEnvFile } from '@runeditrun/rer/internal/modules/deploy-kit/env-file.mjs';
import { ownerRemove } from '@runeditrun/rer/internal/modules/deploy-kit/owner-remove.mjs';
import { activeWorker } from '@runeditrun/rer/internal/modules/deploy-kit/worker.mjs';
import { deploymentOwnership } from './deployment-ownership.mjs';
import { deploymentRecordPath } from './ops-config.mjs';

const { values } = parseArgs({ options: { environment: { type: 'string', default: 'production' }, 'env-file': { type: 'string' }, yes: { type: 'boolean' } } });
try {
  if (!values.yes) throw new Error('Removal deletes both Lamp Workers and this environment’s recorded data. Add --yes to confirm.');
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(values.environment)) throw new Error('Invalid deployment environment.');
  const env = { ...process.env, ...(values['env-file'] ? await readDeployEnvFile(process.cwd(), values['env-file']) : {}) };
  const recordPath = deploymentRecordPath(values.environment);
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  if (record.accountId !== env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Use the Cloudflare account that deployed this environment.');
  const ownership = deploymentOwnership({ environment: values.environment, resourcePrefix: record.resources.worker, appHost: record.appHost, pageHost: record.pageHost }, env);
  const removed = [];
  // The public Worker refers to the app Worker's Durable Object. Release it
  // first, then let Base clear schedules, consumers, stored objects and data.
  for (const page of [true, false]) {
    const state = await ownership.read(page);
    if (page && !state.owned.worker && !state.receipt) {
      if (await activeWorker(ownership.api, ownership.target(page).worker)) throw new Error('The public Worker has no creation record; removal refuses to adopt it');
      continue;
    }
    // Each pass can take a few minutes while Cloudflare confirms the data is gone.
    console.log(page ? 'Removing the public page Worker…' : 'Removing the app Worker, its database, files and queue…');
    const result = await ownerRemove({ api: ownership.api, target: ownership.target(page), statePath: ownership.path(page) });
    removed.push(...result.removed);
  }
  await rm(recordPath);
  console.log(`Removed ${removed.join(', ')}; read back: none remains.`);
} catch (error) {
  // Provider codes and resource names only; never print an API response or inputs.
  console.error(`Removal stopped: ${error.code === 'ENOENT' ? 'no deployment record for this environment' : error.message}. Keep the records and correct the cause before running the same command again.`);
  process.exitCode = 1;
}
