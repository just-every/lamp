import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

test('plain native Vite without explicit local mail mode retains unavailable sender behavior', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(resolve('.t073-unconfigured-ingress-'));
  const origin = `http://127.0.0.1:${Number(process.env.LAMP_DEV_INGRESS_UNCONFIGURED_PORT ?? 57302)}`;
  let server;
  const keys = ['LAMP_WORKERS_STATE_PATH', 'LAMP_VITE_CACHE_DIR', 'LAMP_DISABLE_INSPECTOR', 'LAMP_DEV_OUTBOX_MODE'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    process.env.LAMP_WORKERS_STATE_PATH = join(directory, 'state');
    process.env.LAMP_VITE_CACHE_DIR = join(directory, 'vite-cache');
    process.env.LAMP_DISABLE_INSPECTOR = 'true';
    delete process.env.LAMP_DEV_OUTBOX_MODE;
    execFileSync('pnpm', ['run', 'migrate:local'], { stdio: 'pipe' });
    server = await createServer({ server: { host: '127.0.0.1', port: Number(new URL(origin).port), strictPort: true }, logLevel: 'error' });
    await server.listen();
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    assert.equal((await fetch(`${origin}/__dev/outbox`)).status, 404);
    for (const path of ['/signin/request', '/subscribe']) {
      assert.equal((await fetch(`${origin}${path}`, { method: 'POST', body: new URLSearchParams({ email: 'unknown@ingress.example.test' }) })).status, 503);
    }
  } finally {
    await server?.close();
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(fetch(`${origin}/__dev/outbox`, { signal: AbortSignal.timeout(1000) }));
  }
});
