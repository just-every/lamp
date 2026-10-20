import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cloudflare } from '@runeditrun/rer/internal/modules/deploy-kit/provider.mjs';
import { readOwnerState, settlePendingSecret, writeOwnerState } from '@runeditrun/rer/modules/deploy-kit/owner';

// A secret written with Cloudflare's secrets API, outside this workflow, deploys a
// Worker version the ownership receipt does not name, and every later deploy then
// refuses the Worker as replaced. Record that one named change as the pending secret
// change it was: rer's own settle step adopts it only as the receipt's immediate
// successor, running the receipt's script and build, holding the named secret, with
// every other secret name unchanged. Anything else is refused and nothing is written.
async function main() {
  const [binding, versionId] = (process.argv[2] ?? '').split('=');
  if (!/^[A-Z][A-Z0-9_]*$/.test(binding ?? '') || !/^[0-9a-f-]{36}$/.test(versionId ?? '')) {
    throw new Error('Name the change as SECRET_NAME=<Worker version id>.');
  }
  const record = JSON.parse(await readFile('.seed/deployment/lamp-status.json', 'utf8'));
  const target = { accountId: record.accountId, project: 'just-every/lamp', environment: record.environment, worker: record.resources.worker };
  const path = resolve('.rer/deploy/lamp-status.json');
  const state = await readOwnerState(path, target);
  if (!state.receipt || state.pendingSecret) throw new Error('The ownership record has no settled receipt to extend.');
  const api = cloudflare({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
  state.pendingSecret = { bindings: [binding], present: true, versionId: state.receipt.provider.versionId };
  let live;
  const settled = await settlePendingSecret(api, target.worker, state, { observe: active => { live = active; } });
  if (!settled || live?.versionId !== versionId) {
    throw new Error(`Worker ${target.worker} is not serving ${versionId} as a ${binding}-only change after its recorded version; nothing was recorded.`);
  }
  await writeOwnerState(path, state);
  console.log(`Recorded ${versionId} (${binding} changed outside this workflow) as ${target.worker}'s current version.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
