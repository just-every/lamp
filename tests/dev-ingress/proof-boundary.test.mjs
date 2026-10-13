import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { reservePort } from '../e2e/worker-startup.mjs';
import { createServer } from 'vite';
import { proofHeader } from '../../scripts/dev-ingress/protocol.mjs';
import { devKey, devKeyHeaders } from '../helpers/dev-key.mjs';

test('the native socket boundary rejects a real consumed proof, tampering and cross-instance replay', { timeout: 300_000 }, async () => {
  const directory = await mkdtemp(resolve('.lamp-proof-ingress-'));
  const state = join(directory, 'state');
  const origin = `http://127.0.0.1:${Number(process.env.LAMP_DEV_INGRESS_PROOF_PORT ?? await reservePort({ label: 'dev ingress' }))}`;
  const keys = ['LAMP_WORKERS_STATE_PATH', 'LAMP_VITE_CACHE_DIR', 'LAMP_DEV_OUTBOX_MODE', 'RER_DEV_KEY'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  let server;
  let proof;
  const close = async () => {
    if (!server) return;
    const client = server.environments.client;
    // Drain dependency output before cancellation can race Rolldown writes.
    await client.waitForRequestsIdle();
    await client.depsOptimizer?.scanProcessing;
    await Promise.all(Object.values(client.depsOptimizer?.metadata.discovered ?? {}).map(dependency => dependency.processing));
    await server.close();
    server = undefined;
  };
  const start = async () => {
    server = await createServer({
      server: { host: '127.0.0.1', port: Number(new URL(origin).port), strictPort: true }, logLevel: 'silent',
      plugins: [{
        name: 'test-observe-private-ingress-proof',
        configureServer(vite) { return () => {
          // Read only inside the real Node server, after its ingress boundary.
          // No test route, response, file or log ever receives this material.
          const observe = (request, _response, next) => {
            if (!proof && request.url === '/__dev/outbox') proof = request.headers[proofHeader];
            next();
          };
          const ingress = vite.middlewares.stack.findIndex(layer => layer.handle.name === 'ingress');
          assert.equal(ingress, 0, 'observe after the actual first ingress middleware');
          vite.middlewares.use(observe);
          const layer = vite.middlewares.stack.pop();
          vite.middlewares.stack.splice(ingress + 1, 0, layer);
        }; },
      }],
    });
    await server.listen();
  };
  try {
    process.env.LAMP_WORKERS_STATE_PATH = state;
    process.env.LAMP_VITE_CACHE_DIR = join(directory, 'vite-cache');
    process.env.LAMP_DEV_OUTBOX_MODE = 'local';
    process.env.RER_DEV_KEY = devKey;
    await start();
    assert.equal((await fetch(`${origin}/__dev/outbox`, { headers: devKeyHeaders })).status, 200);
    assert.ok(typeof proof === 'string' && /^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(proof), 'observed an actual native ingress proof privately');
    for (const [path, method, value] of [
      ['/__dev/outbox', 'GET', proof],
      ['/__dev/outbox', 'GET', `${proof.slice(0, -1)}${proof.endsWith('0') ? '1' : '0'}`],
      ['/auth/magic-link', 'POST', proof],
      ['/__dev/outbox?format=json', 'GET', proof],
    ]) {
      assert.equal((await fetch(`${origin}${path}`, { method, headers: { ...devKeyHeaders, [proofHeader]: value } })).status, 404, 'native ingress rejects replay or tampering');
    }
    await mkdir(state, { recursive: true });
    const privateFile = join(state, 'private-access-fixture.txt');
    await writeFile(privateFile, 'test-only private persistence fixture');
    for (const path of [`/@fs${privateFile}`, `/${relative(process.cwd(), privateFile)}`, `/@fs${privateFile}?raw`]) {
      const response = await fetch(`${origin}${path}`);
      assert.ok([403, 404].includes(response.status), 'custom persistence is private to the local server');
      assert.ok(!(await response.text()).includes('test-only private persistence fixture'));
    }
    await close();
    await assert.rejects(fetch(`${origin}/__dev/outbox`));
    await start();
    assert.equal((await fetch(`${origin}/__dev/outbox`, { headers: devKeyHeaders })).status, 200);
    assert.equal((await fetch(`${origin}/__dev/outbox`, { headers: { ...devKeyHeaders, [proofHeader]: proof } })).status, 404, 'proof from another Vite instance stays untrusted');
  } finally {
    await close();
    proof = undefined;
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(fetch(`${origin}/__dev/outbox`, { signal: AbortSignal.timeout(1000) }));
  }
});
