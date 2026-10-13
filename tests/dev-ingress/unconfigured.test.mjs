import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { reservePort } from '../e2e/worker-startup.mjs';
import { createServer } from 'vite';
import { appOrigin, pageOrigin } from '../e2e/helpers/hosts.mjs';
import { localWranglerConfig } from '../helpers/wrangler-config.mjs';
import { authBindings, seedMailOperators, assertUnavailableMail } from './unavailable-mail.mjs';

test('plain native Vite without explicit local mail mode retains unavailable sender behavior', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(resolve('.lamp-unconfigured-ingress-'));
  // A late optimizer write after cleanup lands in node_modules, never in the source tree.
  const cache = await mkdtemp(resolve('node_modules/.lamp-unconfigured-vite-'));
  const port = Number(process.env.LAMP_DEV_INGRESS_UNCONFIGURED_PORT ?? await reservePort({ label: 'dev ingress' }));
  const origin = appOrigin(port);
  let server;
  const state = join(directory, 'state');
  const config = join(directory, 'wrangler.json');
  const bindings = authBindings(origin);
  const keys = ['LAMP_WORKERS_STATE_PATH', 'LAMP_VITE_CACHE_DIR', 'LAMP_DISABLE_INSPECTOR', 'LAMP_DEV_OUTBOX_MODE', 'LAMP_WRANGLER_CONFIG', 'RER_DEV_ORIGIN', 'RER_DEV_KEY', 'RER_DEV_IDENTITY', ...Object.keys(bindings)];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, bindings);
    for (const key of ['RER_DEV_ORIGIN', 'RER_DEV_KEY', 'RER_DEV_IDENTITY']) delete process.env[key];
    await writeFile(config, localWranglerConfig(value => ({ ...value, vars: { ...value.vars, ...bindings } })));
    process.env.LAMP_WRANGLER_CONFIG = config;
    process.env.LAMP_WORKERS_STATE_PATH = state;
    process.env.LAMP_VITE_CACHE_DIR = cache;
    process.env.LAMP_DISABLE_INSPECTOR = 'true';
    delete process.env.LAMP_DEV_OUTBOX_MODE;
    execFileSync('pnpm', ['run', 'migrate:local'], { stdio: 'pipe' });
    seedMailOperators(state);
    server = await createServer({ server: { host: '127.0.0.1', port: Number(new URL(origin).port), strictPort: true }, logLevel: 'error' });
    await server.listen();
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    assert.equal((await fetch(`${origin}/__dev/outbox`)).status, 404);
    await assertUnavailableMail({ origin, publicOrigin: pageOrigin(port), state });
  } finally {
    await server?.close();
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
    await assert.rejects(fetch(`${origin}/__dev/outbox`, { signal: AbortSignal.timeout(1000) }));
  }
});
