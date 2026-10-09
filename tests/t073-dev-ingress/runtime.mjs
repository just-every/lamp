import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { waitForWorker } from '../e2e/worker-startup.mjs';
import { stopProcessGroup } from './shutdown.mjs';

export const port = Number(process.env.LAMP_DEV_INGRESS_PORT ?? 57300);
export const origin = `http://127.0.0.1:${port}`;
export const operator = 'operator@ingress.example.test';
export const subscriber = 'subscriber@ingress.example.test';

export async function openNativeRuntime() {
  const directory = await mkdtemp(resolve('.t073-native-ingress-'));
  const state = join(directory, 'state');
  const env = { ...process.env, LAMP_WORKERS_STATE_PATH: state, LAMP_VITE_CACHE_DIR: join(directory, 'vite-cache') };
  delete env.LAMP_DISABLE_INSPECTOR;
  let child;
  let output = '';
  async function stop() {
    if (!child) return;
    await stopProcessGroup(child);
    child = undefined;
    // The entire pnpm/Vite/workerd group owns this port. Do not leave a listener.
    await assert.rejects(fetch(`${origin}/__dev/outbox`, { signal: AbortSignal.timeout(1000) }));
  }
  return {
    directory, state, env,
    get output() { return output; },
    async seedOperator() {
      // pnpm dev has already applied the real migrations before it listens.
      // Test fixture inserts only an allowed operator. Every session and token
      // below must come from the application's native captured-mail flow.
      execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', state, '--config', 'deploy/wrangler.template.toml', '--command', `INSERT INTO operators (id,email,display_name,is_setup_operator,created_at,updated_at) VALUES ('01J00000000000000000000091','${operator}','Ingress test operator',1,'2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z')`], { env, stdio: 'pipe' });
    },
    async start() {
      child = spawn('pnpm', ['dev', '--port', String(port), '--strictPort'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      await waitForWorker({ origin, child, output: () => output, timeoutMs: 180_000, probe: ({ signal }) => fetch(`${origin}/__dev/outbox?format=json`, { signal }) });
    },
    stop,
    async close() { try { await stop(); } finally { await rm(directory, { recursive: true, force: true }); } },
  };
}

export async function rawRequest(headers = [], target = '/__dev/outbox?format=json') {
  return new Promise((resolveResponse, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let data = '';
    socket.setTimeout(10_000, () => socket.destroy(new Error('Raw ingress request timed out.')));
    socket.on('error', reject);
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => resolveResponse({ status: Number(data.match(/^HTTP\/1\.1 (\d+)/)?.[1]), data }));
    socket.on('connect', () => socket.write(`GET ${target} HTTP/1.1\r\n${headers.join('\r\n')}\r\nConnection: close\r\n\r\n`));
  });
}

export async function envelopes() {
  const response = await fetch(`${origin}/__dev/outbox?format=json`);
  assert.equal(response.status, 200);
  return (await response.json()).envelopes;
}

export async function nativeRequest(path, { cookie, json, ...init } = {}) {
  const response = await fetch(`${origin}${path}`, {
    redirect: 'manual', ...init,
    headers: { ...init.headers, ...(cookie ? { cookie } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
  return response;
}
