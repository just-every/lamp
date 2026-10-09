import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startInstaller } from './server.mjs';
import { createState } from './state.mjs';
import { validateAnswers } from './prefill.mjs';
import { createModel } from './ui/model-core.mjs';

const model = {
 fields: { serviceName: { label: 'Service', valid: value => typeof value === 'string' && value.length > 0 }, monitorToken: { type: 'password', valid: value => typeof value === 'string' && value.length >= 12 }, prefix: { valid: value => typeof value === 'string' } },
 safeKeys: ['serviceName', 'prefix'], secretScopes: { monitorToken: ['serviceName'] },
};
const seed = { product: 'Status contract fixture', features: {}, model, browserModule: 'seed.mjs', validateInput: value => value, install: async (_root, _input, store) => store.phase('complete') };
async function directory(t) { const root = await mkdtemp(join(tmpdir(), 'rer-onboarding-contract-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function session(t, changes = {}) {
 const root = await directory(t);
 const server = await startInstaller(root, { seed: { ...seed, ...changes }, noPrefill: true });
 t.after(() => server.close());
 const page = await fetch(server.origin); const html = await page.text();
 const headers = { Origin: server.origin, Cookie: page.headers.get('set-cookie').split(';')[0], 'X-Installer-Token': html.match(/name="installer-token" content="([a-f0-9]+)"/)[1], 'Content-Type': 'application/json' };
 const call = async (path, value) => { const response = await fetch(server.origin + path, { headers, ...(value === undefined ? {} : { method: 'POST', body: JSON.stringify(value) }) }); return { status: response.status, body: await response.json() }; };
 return { root, server, call, headers };
}

test('distinct seed accepts only declared public fields and never invents H2H modes', () => {
 assert.deepEqual(validateAnswers({ serviceName: 'API', prefix: 'status' }, model), { serviceName: 'API', prefix: 'status' });
 for (const input of [{ password: 'not-public' }, { monitorToken: 'private-token' }, { allowedOrigin: 'https://example.com' }]) assert.throws(() => validateAnswers(input, model));
});

test('saved details reject another product and strip undeclared or secret draft keys', async t => {
 const root = await directory(t), path = join(root, '.seed/installer/state.json');
 await mkdir(join(root, '.seed/installer'), { recursive: true });
 await writeFile(path, JSON.stringify({ product: seed.product, draft: { serviceName: 'API', monitorToken: 'SECRET_SENTINEL', alien: 'wrong' } }));
 const store = await createState(root, seed);
 assert.deepEqual(store.state.draft, { serviceName: 'API' });
 await store.draft(store.state.draft);
 assert.equal(JSON.parse(await readFile(path, 'utf8')).product, seed.product);
 await assert.rejects(createState(root, { ...seed, product: 'Other seed' }), /another seed/);
});

test('sparse seed rejects unsupported capabilities and requires authenticated same-origin writes', async t => {
 const { server, call, headers } = await session(t);
 assert.equal((await fetch(server.origin + '/api/state')).status, 403);
 assert.equal((await fetch(server.origin + '/api/draft', { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: JSON.stringify({ serviceName: 'Cross origin' }) })).status, 403);
 for (const path of ['/api/address', '/api/workspace-art']) assert.equal((await call(path, {})).status, 404);
 for (const provider of ['cloudflare', 'github']) assert.equal((await call('/api/connect', { provider })).status, 400);
 assert.deepEqual((await call('/api/state')).body.known.providers, {});
 assert.equal((await call('/api/draft', { monitorToken: 'SECRET_SENTINEL' })).status, 400);
});

test('custom credential stays private, follows its scope, and agent activity reflects actual reports', async t => {
 const { root, call } = await session(t);
 let state = (await call('/api/state')).body;
 assert.equal(state.agent.attached, false);
 await call('/api/agent-handoff');
 assert.equal((await call('/api/state')).body.agent.attached, false);
 await call('/api/prefill', { serviceName: 'API' });
 state = (await call('/api/state')).body;
 assert.equal(state.sources.serviceName, 'agent');
 assert.equal(state.agent.attached, true);
 assert.equal((await call('/api/secrets', { revision: state.lastUpdate.revision, secrets: { monitorToken: 'SECRET_SENTINEL' } })).status, 200);
 state = (await call('/api/state')).body;
 assert.equal(state.known.secretReadiness.monitorToken, true);
 const browser = createModel({ ...model, product: { name: seed.product }, setupGroups: [{ id: 'service', keys: ['serviceName', 'monitorToken'] }] });
 assert.equal(browser.secretReady('monitorToken', { serviceName: 'API' }, state.known), true);
 assert.equal(browser.secretReady('monitorToken', { serviceName: 'Locally edited' }, state.known), false);
 assert.ok(!JSON.stringify(state).includes('SECRET_SENTINEL'));
 assert.ok(!(await readFile(join(root, '.seed/installer/state.json'), 'utf8')).includes('SECRET_SENTINEL'));
 await call('/api/draft', { serviceName: 'Website' });
 assert.equal((await call('/api/state')).body.known.secretReadiness.monitorToken, false);
});

test('adapter rejection produces a safe failed state without exposing provider errors', async t => {
 let signalFailure;
 const failed = new Promise(resolve => { signalFailure = resolve; });
 const { call } = await session(t, { install: async (_root, _input, store) => {
  const phase = store.phase;
  store.phase = async value => { const result = await phase(value); if (value === 'failed') signalFailure(); return result; };
  throw Error('SECRET_SENTINEL');
 } });
 assert.equal((await call('/api/start', { serviceName: 'API' })).status, 202);
 await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Installer failure did not settle.')), 1000); failed.then(() => { clearTimeout(timer); resolve(); }); });
 const state = (await call('/api/state')).body;
 assert.equal(state.phase, 'failed');
 assert.ok(!JSON.stringify(state).includes('SECRET_SENTINEL'));
});

test('agent inference preserves owner overrides and their provenance', async t => {
 const { call } = await session(t);
 await call('/api/prefill', { serviceName: 'Inferred API', prefix: 'api' });
 await call('/api/draft', { serviceName: 'Owner service' });
 assert.equal((await call('/api/prefill', { serviceName: 'Later inference', prefix: 'new-prefix' })).status, 200);
 const state = (await call('/api/state')).body;
 assert.equal(state.draft.serviceName, 'Owner service');
 assert.equal(state.sources.serviceName, 'browser');
 assert.equal(state.draft.prefix, 'new-prefix');
 assert.equal(state.sources.prefix, 'agent');
});

test('only explicit start invokes the seed adapter with its custom credential', async t => {
 let installs = 0, received, signalComplete;
 const completed = new Promise(resolve => { signalComplete = resolve; });
 const { call } = await session(t, { install: async (_root, input, store) => {
  installs++; received = { ...input };
  const phase = store.phase;
  store.phase = async value => { const result = await phase(value); if (value === 'complete') signalComplete(); return result; };
  await store.phase('complete');
 } });
 await call('/api/prefill', { serviceName: 'API' });
 let state = (await call('/api/state')).body;
 await call('/api/secrets', { revision: state.lastUpdate.revision, secrets: { monitorToken: 'SECRET_SENTINEL' } });
 await call('/api/activity', { phase: 'complete', topic: 'setup' });
 assert.equal(installs, 0);
 assert.equal((await call('/api/start', { serviceName: 'API' })).status, 202);
 await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Installer completion did not settle.')), 1000); completed.then(() => { clearTimeout(timer); resolve(); }); });
 state = (await call('/api/state')).body;
 assert.equal(installs, 1);
 assert.deepEqual(received, { serviceName: 'API', monitorToken: 'SECRET_SENTINEL' });
 assert.equal(state.phase, 'complete');
 assert.ok(!JSON.stringify(state).includes('SECRET_SENTINEL'));
 assert.equal((await call('/api/start', { serviceName: 'API' })).status, 409);
});
