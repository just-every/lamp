import { requestHeaders } from "../helpers/request-headers.mjs";
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { basename, join, resolve } from 'node:path';
import { appOrigin, pageOrigin } from '../e2e/helpers/hosts.mjs';
import { reservePort, waitForWorker } from '../e2e/worker-startup.mjs';
import { stopProcessGroup } from './shutdown.mjs';
import { devKey, devKeyHeaders } from '../helpers/dev-key.mjs';

export let port;
// The operator app host; the public status page answers on its own page host.
export let origin;
export let publicOrigin;
export const operator = 'operator@ingress.example.test';
export const subscriber = 'subscriber@ingress.example.test';

export async function openNativeRuntime({ fixtureVars = {} } = {}) {
  const directory = await mkdtemp(resolve('.lamp-native-ingress-'));
  const state = join(directory, 'state');
  // The app host serves development modules under /node_modules/. Each run
  // owns only this unique cache, including when node_modules is a shared link.
  const cache = resolve('node_modules/.vite', basename(directory));
  const fixturePort = Number(process.env.LAMP_DEV_INGRESS_PORT ?? await reservePort({ label: 'dev ingress' }));
  const fixturePublicOrigin = pageOrigin(fixturePort);
  // Pausing one fixture to visit another must not replace its transport context.
  function activate() {
    port = fixturePort;
    origin = appOrigin(fixturePort, fixtureVars);
    publicOrigin = fixturePublicOrigin;
  }
  activate();
  const fixtureOrigin = origin;
  const env = { ...process.env, LAMP_WORKERS_STATE_PATH: state, LAMP_VITE_CACHE_DIR: cache, RER_DEV_KEY: devKey, RER_DEV_ORIGIN: fixtureOrigin, RER_DEV_IDENTITY: "on", AUTH_ORIGIN: fixtureOrigin, AUTH_LOCAL: "true", SETUP_OPERATOR_EMAIL: operator, SESSION_SECRET: "test-session-secret-".repeat(4) };
  delete env.LAMP_DISABLE_INSPECTOR;
  let child;
  let output = '';
  async function stop() {
    if (!child) return;
    await stopProcessGroup(child);
    child = undefined;
    // The entire pnpm/Vite/workerd group owns this port. Do not leave a listener.
    await assert.rejects(fetch(`${fixtureOrigin}/health`, { signal: AbortSignal.timeout(1000) }));
  }
  return {
    directory, state, env, port: fixturePort, origin: fixtureOrigin, publicOrigin: fixturePublicOrigin,
    get output() { return output; },
    async seedOperator() {
      // pnpm dev has already applied the real migrations before it listens.
      // The fixture supplies the owner with its claim, and page settings, explicitly. Sessions use
      // the pinned rer's automatic owner entry; no mailbox is retained.
      // Post-migration inserts need the persisted identity that migration0007
      // backfills for existing rows; Atom is part of the first public snapshot.
      // Setup also persists the selected sender. Keep this fixture aligned with
      // the local Wrangler sender; an empty stored sender disables sign-in mail.
      execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', state, '--config', 'wrangler.jsonc', '--command', `INSERT INTO oa_operators (id,email,display_name,role,status,created_at) VALUES ('01J00000000000000000000091','${operator}','Ingress test operator','owner','active',${Date.now()}); INSERT INTO oa_bootstrap (singleton,claim_id,claimed_at) VALUES (1,'01J00000000000000000000091',${Date.now()}); INSERT INTO page_settings (id,page_name,tagline,accent_color,timezone,hostname,feed_id,mail_from_address,created_at,updated_at) VALUES ('default','Ingress fixture','Local native mail test','#123456','UTC','${new URL(fixturePublicOrigin).hostname}',lower(hex(randomblob(16))),'lamp@localhost.invalid','2026-10-06','2026-10-06'); INSERT INTO setup_readiness (step,evidence_key,checked_at) VALUES ('first-run','complete','2026-10-06')`], { env, stdio: 'pipe' });
    },
    async start() {
      activate();
      const outputStart = output.length;
      child = spawn('pnpm', ['run', 'dev:app', '--port', String(fixturePort), '--strictPort'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      await waitForWorker({ origin: fixtureOrigin, child, output: () => output, timeoutMs: 180_000, isListening: () => output.slice(outputStart).includes(`http://127.0.0.1:${fixturePort}/`), probe: ({ signal }) => fetch(`${fixtureOrigin}/health?format=json`, { signal, headers: devKeyHeaders }) });
    },
    stop,
    async close() { try { await stop(); } finally { await rm(cache, { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); } },
  };
}

export async function rawRequest(headers = [], target = '/health?format=json') {
  return new Promise((resolveResponse, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let data = '';
    socket.setTimeout(10_000, () => socket.destroy(new Error('Raw ingress request timed out.')));
    socket.on('error', reject);
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => resolveResponse({ status: Number(data.match(/^HTTP\/1\.1 (\d+)/)?.[1]), data }));
    socket.on('connect', () => socket.write(`GET ${target} HTTP/1.1\r\n${[...headers, `x-rer-dev-key: ${devKey}`].join('\r\n')}\r\nConnection: close\r\n\r\n`));
  });
}

export async function nativeRequest(path, { cookie, json, host = origin, ...init } = {}) {
  const headers = requestHeaders({ Origin: host, ...(cookie ? { Cookie: cookie } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) }, init.headers);
  const response = await fetch(`${host}${path}`, {
    redirect: 'manual', ...init, headers,
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
  return response;
}
