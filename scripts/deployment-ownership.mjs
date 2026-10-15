import { resolve } from 'node:path';
import { cloudflare } from '@runeditrun/rer/internal/modules/deploy-kit/provider.mjs';
import { readOwnerState, writeOwnerState, sameDeployment, resourceId } from '@runeditrun/rer/modules/deploy-kit/owner';
import { activeWorker, deployedFingerprint } from '@runeditrun/rer/internal/modules/deploy-kit/worker.mjs';
import { resourceNames } from './ops-config.mjs';

// Native Lamp keeps its established two-Worker topology and resource names.
// Record actual creation identities in Base's format so signin and teardown
// have the same ownership boundary as an ordinary rer deployment.
export function deploymentOwnership(config, env = process.env) {
  const names = resourceNames(config.environment, config.resourcePrefix);
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) {
    if (!env[name]?.trim()) throw new Error(`${name} is required for native deployment ownership.`);
  }
  const api = cloudflare({ accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, maxRequests: Infinity });
  const target = (page = false) => ({ accountId: api.accountId, project: 'just-every/lamp', environment: config.environment,
    worker: page ? names.publicWorker : names.worker, origin: `https://${page ? config.pageHost : config.appHost}` });
  const path = (page = false) => resolve('.rer', 'deploy', `${config.environment}${page ? '.page' : ''}.json`);
  const read = (page = false) => readOwnerState(path(page), target(page));
  const save = (state, page = false) => writeOwnerState(path(page), state);
  return { api, target, path, read,
    async resource(kind, name, find, create) {
      const state = await read(), existing = await find();
      if (existing) {
        const entry = state.owned[kind][name];
        if (entry?.status !== 'created' || entry.id !== resourceId(kind, existing)) throw new Error(`Refusing unrecorded or replaced ${kind} resource ${name}. Keep its original deployment record; it was not created by this checkout.`);
        return existing;
      }
      if (state.owned[kind][name]) throw new Error(`Recorded ${kind} resource ${name} is missing. Finish removing this environment before deploying it again.`);
      state.owned[kind][name] = { status: 'pending' };
      await save(state);
      const made = await create();
      const id = resourceId(kind, made);
      if (!id) throw new Error(`The provider did not identify the created ${kind} resource ${name}. Keep the deployment record and inspect it before continuing.`);
      state.owned[kind][name] = { status: 'created', id };
      await save(state);
      return made;
    },
    async upload(page, identity, action) {
      const state = await read(page), selected = target(page);
      const live = await activeWorker(api, selected.worker);
      if (live && !sameDeployment(live, state.receipt?.provider)) throw new Error(`Refusing unrecorded or replaced Worker ${selected.worker}. Keep its original deployment record.`);
      if (!live && state.owned.worker?.status === 'created') throw new Error(`Recorded Worker ${selected.worker} is missing. Finish removing this environment before deploying it again.`);
      state.owned.worker ??= { status: 'pending' };
      state.pendingUpload = { fingerprint: identity.fingerprint, build: identity.fingerprint };
      await save(state, page);
      await action();
      const uploaded = await activeWorker(api, selected.worker);
      if (!uploaded || deployedFingerprint(uploaded.settings) !== identity.fingerprint) throw new Error(`Worker ${selected.worker} does not report the uploaded build. Keep the deployment record and inspect it before continuing.`);
      const { versionId, deploymentId, etag } = uploaded;
      state.owned.worker = { status: 'created' };
      state.receipt = { origin: selected.origin, source: { sha: identity.source }, fingerprint: identity.fingerprint, provider: { versionId, deploymentId, etag } };
      delete state.pendingUpload;
      await save(state, page);
    },
  };
}
