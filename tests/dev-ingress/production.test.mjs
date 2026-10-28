import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { appHost, appOrigin, pageHost, pageOrigin } from '../e2e/helpers/hosts.mjs';
import { reservePort, waitForWorker } from '../e2e/worker-startup.mjs';
import { stopProcessGroup } from './shutdown.mjs';
import { authBindings, seedMailOperators, assertUnavailableMail } from './unavailable-mail.mjs';

test('emitted production excludes development ingress and rejects runtime dev bindings and flags', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(resolve('.lamp-production-ingress-'));
  const port = Number(process.env.LAMP_DEV_INGRESS_PRODUCTION_PORT ?? await reservePort({ label: 'dev ingress' }));
  const origin = appOrigin(port);
  let child;
  let output = '';
  try {
    execFileSync('pnpm', ['run', 'build:app'], { env: { ...process.env, LAMP_DEV_OUTBOX_MODE: 'local', LAMP_DISABLE_INSPECTOR: 'true', LAMP_VITE_CACHE_DIR: join(directory, 'vite-cache') }, stdio: 'pipe' });
    // Exercise the emitted Worker with hostile runtime bindings below. Literal
    // addresses can legitimately appear in the bundled owner documentation.
    const artifact = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
    const devKey = randomBytes(32).toString('base64url');
    const production = { ...artifact, main: resolve('dist/server', artifact.main), assets: { ...artifact.assets, directory: resolve('dist/server', artifact.assets.directory) }, vars: { ...artifact.vars, ...authBindings(origin), RER_DEV_KEY: devKey, RER_DEV_ORIGIN: origin, RER_DEV_IDENTITY: 'on', LAMP_APP_HOST: appHost, LAMP_PAGE_HOST: pageHost, LAMP_LOCAL_MAIL: 'true', LAMP_DEV_MAIL: 'true', LAMP_DEV_OUTBOX_MODE: 'local' }, r2_buckets: [...artifact.r2_buckets, { binding: 'LAMP_DEV_OUTBOX', bucket_name: 'test-production-injection' }] };
    // The deployed Worker is unchanged. These deliberately hostile local test
    // bindings must not revive code that the production compiler removed.
    const config = join(directory, 'wrangler.json');
    await writeFile(config, JSON.stringify(production));
    const state = join(directory, 'state');
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state, '--config', 'wrangler.jsonc'], { maxBuffer: 4 * 1024 * 1024, stdio: 'pipe' });
    seedMailOperators(state);
    child = spawn('pnpm', ['exec', 'wrangler', 'dev', '--config', config, '--local', '--port', String(port), '--inspector-port', '0', '--persist-to', state], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    await waitForWorker({ origin, child, output: () => output, timeoutMs: 45_000, probe: async ({ signal }) => {
      const response = await fetch(`${origin}/__dev/outbox`, { signal });
      return { status: response.status === 404 ? 200 : response.status, text: () => response.text() };
    } });
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `public.example.test:${port}`]) {
      assert.equal((await fetch(`${origin}/__dev/outbox?format=json`, { headers: { Host: host, 'X-Lamp-Dev-Ingress': 'injected-runtime-proof', 'X-Forwarded-Host': host } })).status, 404);
    }
    for (const path of ['/__dev/outbox?format=json', '/auth/dev/enter?as=owner', '/__dev/personas', '/__dev/key']) {
      const response = await fetch(`${origin}${path}`, { redirect: 'manual', headers: { 'x-rer-dev-key': devKey } });
      assert.equal(response.status, 404, 'runtime bindings cannot revive development identity');
      assert.equal(response.headers.get('set-cookie'), null);
    }
    const exchange = await fetch(`${origin}/__dev/key`, {
      method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: devKey }),
    });
    assert.equal(exchange.status, 404, 'runtime key cannot establish a development gate cookie');
    assert.equal(exchange.headers.get('set-cookie'), null);
    const signIn = await fetch(`${origin}/signin`);
    assert.equal(signIn.status, 200);
    assert.doesNotMatch(await signIn.text(), /\/__dev\/outbox/);
    await assertUnavailableMail({ origin, publicOrigin: pageOrigin(port), state });
  } finally {
    if (child) {
      await stopProcessGroup(child);
      await assert.rejects(fetch(`${origin}/__dev/outbox`, { signal: AbortSignal.timeout(1000) }));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
