import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { waitForWorker } from '../e2e/worker-startup.mjs';
import { stopProcessGroup } from './shutdown.mjs';

async function allFiles(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? allFiles(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

test('emitted production has no ingress key/module or capture implementation, even with runtime dev bindings and flags', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(resolve('.t073-production-ingress-'));
  const port = Number(process.env.LAMP_DEV_INGRESS_PRODUCTION_PORT ?? 57301);
  const origin = `http://127.0.0.1:${port}`;
  let child;
  let output = '';
  try {
    execFileSync('pnpm', ['run', 'build'], { env: { ...process.env, LAMP_DEV_OUTBOX_MODE: 'local', LAMP_DISABLE_INSPECTOR: 'true', LAMP_VITE_CACHE_DIR: join(directory, 'vite-cache') }, stdio: 'pipe' });
    for (const file of await allFiles('dist')) {
      if (!/\.(js|mjs|json|map|html)$/.test(file)) continue;
      const source = await readFile(file, 'utf8');
      assert.ok(!/virtual:lamp-dev-ingress|x-lamp-dev-ingress|LAMP_DEV_OUTBOX|\/__dev\/outbox|authenticateDevelopmentRequest|createDevelopmentAuthenticator|configuration\/subscriber-token-secret|lamp-local-development-outbox/.test(source), file);
    }
    const artifact = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
    assert.equal(artifact.r2_buckets.some(bucket => bucket.binding === 'LAMP_DEV_OUTBOX'), false);
    const production = { ...artifact, main: resolve('dist/server', artifact.main), assets: { ...artifact.assets, directory: resolve('dist/server', artifact.assets.directory) }, vars: { ...artifact.vars, LAMP_APP_HOST: '127.0.0.1', LAMP_PAGE_HOST: '127.0.0.1', LAMP_LOCAL_MAIL: 'true', LAMP_DEV_MAIL: 'true', LAMP_DEV_OUTBOX_MODE: 'local' }, r2_buckets: [...artifact.r2_buckets, { binding: 'LAMP_DEV_OUTBOX', bucket_name: 'test-production-injection' }] };
    // The deployed Worker is unchanged. These deliberately hostile local test
    // bindings must not revive code that the production compiler removed.
    const config = join(directory, 'wrangler.json');
    await writeFile(config, JSON.stringify(production));
    const state = join(directory, 'state');
    execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state, '--config', 'deploy/wrangler.template.toml'], { stdio: 'pipe' });
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
    for (const path of ['/signin/request', '/subscribe']) {
      assert.equal((await fetch(`${origin}${path}`, { method: 'POST', body: new URLSearchParams({ email: 'unknown@ingress.example.test' }) })).status, 503, 'production mail remains honestly unavailable');
    }
  } finally {
    if (child) {
      await stopProcessGroup(child);
      await assert.rejects(fetch(`${origin}/__dev/outbox`, { signal: AbortSignal.timeout(1000) }));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
